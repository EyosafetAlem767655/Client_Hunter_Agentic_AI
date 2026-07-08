"""POST /api/py/scrape_jobdesc  (and CLI: python scrape_jobdesc.py <url> [source])

Pull the FULL job description from a single job posting URL.

Plain HTTP fetches only get a short snippet (Indeed) or a bot-check page, so we
cascade through the strongest engines available:

  1. Playwright headless Chromium — renders JS, best for LinkedIn/JS pages
     (only when browser binaries are installed; optional on Vercel).
  2. curl_cffi — impersonates Chrome's TLS fingerprint, bypasses Indeed's
     bot detection. Works on Vercel's Python runtime with no browser.
  3. requests — plain static HTML fallback.

Then a site-aware BeautifulSoup pass pulls the description container out of the
rendered HTML. Returns clean text; the TypeScript caller can LLM-format it.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from typing import Any

import requests
from bs4 import BeautifulSoup


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
HTTP_HEADERS = {
    "User-Agent": BROWSER_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
PAGE_TIMEOUT_MS = 20_000
MIN_DESCRIPTION_LEN = 200

# Site-aware selectors, tried in order. The first match with enough text wins.
DESCRIPTION_SELECTORS = [
    "#jobDescriptionText",
    "[data-testid='jobsearch-jobDescriptionText']",
    ".jobsearch-JobComponent-description",
    ".show-more-less-html__markup",
    ".description__text",
    "[class*='jobDescription']",
    "[class*='job-description']",
    "[class*='job_description']",
    "[data-automation='jobDescription']",
    "[data-cy='job-description']",
    ".posting-requirements",
    "article",
    "[role='main']",
    "main",
]


def _clean_text(node) -> str:
    for bad in node(["script", "style", "noscript"]):
        bad.decompose()
    # Preserve block structure as newlines, then collapse runs of blank lines.
    text = node.get_text("\n", strip=True)
    lines = [ln.strip() for ln in text.splitlines()]
    out: list[str] = []
    blanks = 0
    for ln in lines:
        if ln:
            out.append(ln)
            blanks = 0
        elif blanks == 0:
            out.append("")
            blanks = 1
    return "\n".join(out).strip()


def extract_description(html: str) -> str:
    """Pull the best job-description block out of rendered HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()

    best = ""
    for selector in DESCRIPTION_SELECTORS:
        try:
            el = soup.select_one(selector)
        except Exception:
            continue
        if not el:
            continue
        text = _clean_text(el)
        if len(text) > len(best):
            best = text
        # An explicit description container that's substantial — take it.
        if selector.startswith(("#", ".", "[data")) and len(text) >= MIN_DESCRIPTION_LEN:
            return text[:20_000]

    return best[:20_000]


def _try_playwright_import():
    try:
        from playwright.sync_api import sync_playwright  # type: ignore

        return sync_playwright
    except Exception:
        return None


def _fetch_playwright(sync_playwright, url: str) -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            ctx = browser.new_context(user_agent=BROWSER_UA)
            page = ctx.new_page()
            page.goto(url, wait_until="networkidle", timeout=PAGE_TIMEOUT_MS)
            # LinkedIn hides most of the text behind a "show more" toggle.
            for sel in (
                "button.show-more-less-html__button",
                "button[aria-label*='more']",
            ):
                try:
                    btn = page.query_selector(sel)
                    if btn:
                        btn.click(timeout=1_500)
                except Exception:
                    pass
            return page.content()
        finally:
            browser.close()


def _fetch_curl_cffi(url: str) -> str:
    from curl_cffi import requests as cffi  # type: ignore

    session = cffi.Session(impersonate="chrome")
    r = session.get(url, headers=HTTP_HEADERS, timeout=15, allow_redirects=True)
    r.raise_for_status()
    return r.text


def _fetch_requests(url: str) -> str:
    r = requests.get(url, headers=HTTP_HEADERS, timeout=15, allow_redirects=True)
    r.raise_for_status()
    return r.text


def scrape_description(url: str) -> dict[str, Any]:
    """Try each engine until one yields a substantial description."""
    attempts: list[tuple[str, Any]] = []
    sync_playwright = _try_playwright_import()
    if sync_playwright is not None:
        attempts.append(("playwright", lambda: _fetch_playwright(sync_playwright, url)))
    attempts.append(("curl_cffi", lambda: _fetch_curl_cffi(url)))
    attempts.append(("requests", lambda: _fetch_requests(url)))

    best_text = ""
    best_engine = "none"
    last_error = ""
    for engine, fetch in attempts:
        try:
            html = fetch()
            text = extract_description(html)
            if len(text) > len(best_text):
                best_text, best_engine = text, engine
            if len(best_text) >= MIN_DESCRIPTION_LEN:
                break
        except Exception as exc:  # noqa: BLE001 — try the next engine
            last_error = f"{engine}: {str(exc)[:150]}"
            continue

    ok = len(best_text) >= MIN_DESCRIPTION_LEN
    result: dict[str, Any] = {
        "ok": ok,
        "url": url,
        "description": best_text,
        "length": len(best_text),
        "engine": best_engine,
    }
    if not ok and last_error:
        result["error"] = last_error
    return result


def _authorized(headers) -> bool:
    cron_secret = (os.environ.get("CRON_SECRET") or "").strip()
    admin_token = (os.environ.get("ADMIN_TOKEN") or "").strip()
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if token and token in {cron_secret, admin_token}:
            return True
    if os.environ.get("VERCEL") == "1" and headers.get("x-vercel-cron") == "1":
        return True
    return False


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not _authorized(self.headers):
            self._respond(401, {"error": "Unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")
        except Exception as exc:
            self._respond(400, {"error": f"Bad JSON: {exc}"})
            return

        url = (payload.get("url") or "").strip()
        if not url.startswith("http"):
            self._respond(400, {"error": "url: http(s) string required"})
            return

        try:
            self._respond(200, scrape_description(url))
        except Exception as exc:
            self._respond(500, {"ok": False, "error": str(exc)[:300]})

    def _respond(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(encoded)


# ── CLI subprocess entry-point (used by the TypeScript route in local dev) ─────

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else ""
    if not target.startswith("http"):
        print(json.dumps({"ok": False, "error": "usage: scrape_jobdesc.py <url>"}))
        sys.exit(1)
    try:
        print(json.dumps(scrape_description(target)))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:300]}))
        sys.exit(1)
