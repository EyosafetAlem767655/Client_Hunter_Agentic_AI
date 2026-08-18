"""POST /api/py/scrape_contact

Take a list of URLs (typically `/contact` pages found for a company),
load each one, and return everything a downstream LLM needs to pick out
the right outreach email:

  - the visible text of the page
  - every `mailto:` link
  - a flag telling the caller whether we used Playwright (JS-rendered DOM)
    or fell back to plain `requests` (server-side HTML only)

The caller hands the bundle to Gemini,
which extracts the best email. No regex parsing happens here.

Playwright is preferred — many marketing sites JS-render their contact
info — but it requires browser binaries that aren't always installed
on Vercel's Python runtime. The endpoint imports it lazily and falls
back to `requests + BeautifulSoup` when unavailable, so it works in
both environments.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Per-page wall-time. Each /api/manual/discover/next call processes one
# company → at most ~3 candidate URLs, so 8 s × 3 ≈ 24 s, well inside the
# Vercel 60 s function ceiling.
PER_PAGE_TIMEOUT_MS = 8_000
MAX_DOM_ELEMENTS = 700
MAX_ELEMENT_TEXT = 500
MAX_ATTR_VALUE = 300


def _compact_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key, value in attrs.items():
        if isinstance(value, list):
            compact[key] = [str(v)[:MAX_ATTR_VALUE] for v in value[:10]]
        else:
            compact[key] = str(value)[:MAX_ATTR_VALUE]
    return compact


def _structured_elements(soup: BeautifulSoup) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []
    for element in soup.find_all(True):
        text = element.get_text(" ", strip=True)
        elements.append(
            {
                "tag": element.name,
                "attributes": _compact_attrs(element.attrs),
                "text": text[:MAX_ELEMENT_TEXT],
            }
        )
        if len(elements) >= MAX_DOM_ELEMENTS:
            break
    return elements


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


def _try_playwright_import():
    """Return playwright's sync API if importable, else None.

    Importing fails silently when the package isn't installed or the
    browser binary isn't present (common on plain Vercel deployments).
    """
    try:
        from playwright.sync_api import sync_playwright  # type: ignore

        return sync_playwright
    except Exception:
        return None


def _extract_with_requests(url: str) -> dict[str, Any]:
    """Static HTML fallback. Works everywhere, captures server-rendered text."""
    response = requests.get(
        url,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
        timeout=PER_PAGE_TIMEOUT_MS / 1000,
        allow_redirects=True,
    )
    response.raise_for_status()
    html = response.text
    soup = BeautifulSoup(html, "html.parser")

    # Strip script / style so the text blob doesn't have minified JS noise.
    for bad in soup(["script", "style", "noscript"]):
        bad.decompose()

    text = soup.get_text(" ", strip=True)
    elements = _structured_elements(soup)

    mailtos: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if href.lower().startswith("mailto:"):
            mailtos.append(href[7:].split("?")[0].strip())

    return {
        "url": url,
        "text": text[:20_000],  # Keep downstream Gemini prompts bounded
        "mailtos": list(dict.fromkeys(mailtos))[:50],
        "elements": elements,
        "engine": "requests",
        "ok": True,
    }


def _extract_with_playwright(sync_playwright, url: str) -> dict[str, Any]:
    """JS-rendered DOM via headless Chromium.

    Loads the page, waits for the network to go idle, then pulls the
    rendered text + every `mailto:` href. Falls through to the requests
    fallback on any exception (browser binaries missing, etc.).
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(user_agent=BROWSER_UA)
            page = context.new_page()
            page.goto(
                url,
                wait_until="networkidle",
                timeout=PER_PAGE_TIMEOUT_MS,
            )
            text = page.evaluate("() => document.body.innerText") or ""
            html = page.content()
            soup = BeautifulSoup(html, "html.parser")
            for bad in soup(["script", "style", "noscript"]):
                bad.decompose()
            elements = _structured_elements(soup)
            anchors: list[str] = page.evaluate(
                """
                () => Array.from(document.querySelectorAll('a[href]'))
                  .map(a => a.getAttribute('href') || '')
                """
            )
            mailtos: list[str] = []
            for href in anchors:
                lower = (href or "").strip().lower()
                if lower.startswith("mailto:"):
                    mailtos.append(href[7:].split("?")[0].strip())
            # Also harvest absolute URLs from relative anchors — sometimes
            # the contact page links out to a contact form on a sub-path.
            return {
                "url": url,
                "text": text[:20_000],
                "mailtos": list(dict.fromkeys(mailtos))[:50],
                "elements": elements,
                "engine": "playwright",
                "ok": True,
            }
        finally:
            browser.close()


def scrape_one(url: str, sync_playwright) -> dict[str, Any]:
    # Prefer Playwright when available — it sees JS-rendered emails the
    # static fetch can't. Fall back the moment anything goes wrong.
    if sync_playwright is not None:
        try:
            return _extract_with_playwright(sync_playwright, url)
        except Exception as exc:
            try:
                fallback = _extract_with_requests(url)
                fallback["engine"] = "requests_after_playwright_error"
                fallback["playwright_error"] = str(exc)[:200]
                return fallback
            except Exception as inner:
                return {
                    "url": url,
                    "text": "",
                    "mailtos": [],
                    "elements": [],
                    "engine": "none",
                    "ok": False,
                    "error": f"playwright: {exc}; requests: {inner}"[:300],
                }
    try:
        return _extract_with_requests(url)
    except Exception as exc:
        return {
            "url": url,
            "text": "",
            "mailtos": [],
            "elements": [],
            "engine": "requests",
            "ok": False,
            "error": str(exc)[:300],
        }


def scrape_many(urls: list[str]) -> dict[str, Any]:
    sync_playwright = _try_playwright_import()
    capped = urls[:6]
    results = [scrape_one(u, sync_playwright) for u in capped]
    return {
        "results": results,
        "engine_available": "playwright" if sync_playwright else "requests",
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not _authorized(self.headers):
            self.send_response(401)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw or b"{}")
        except Exception as exc:
            self.send_response(400)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": f"Bad JSON: {exc}"}).encode()
            )
            return

        urls = payload.get("urls") or []
        if not isinstance(urls, list) or not urls:
            self.send_response(400)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": "urls: [string] required"}).encode()
            )
            return

        # Normalise: keep only http(s) strings and dedupe.
        normalised: list[str] = []
        seen: set[str] = set()
        for u in urls:
            if not isinstance(u, str):
                continue
            cleaned = urljoin(u, "")  # canonicalise
            if not cleaned.startswith("http"):
                continue
            if cleaned in seen:
                continue
            seen.add(cleaned)
            normalised.append(cleaned)

        try:
            result = scrape_many(normalised)
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_response(500)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)}).encode())
