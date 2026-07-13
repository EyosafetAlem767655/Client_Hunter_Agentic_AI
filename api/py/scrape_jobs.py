"""POST /api/py/scrape_jobs

Per-source job scraper using requests + BeautifulSoup for all active sources
(Remotive, Jobicy, We Work Remotely, LinkedIn, HN Hiring).

POST body: { "source": "linkedin" }
Response:  { "ok": true, "jobs": [...], "engine": "requests", "count": N }

Each source gets the full 60-second Vercel function budget because individual
site buttons trigger this endpoint one source at a time.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Medical admin keywords used to pre-filter HN Hiring thread comments
MEDICAL_KEYWORDS = [
    "medical receptionist", "front desk", "patient service", "patient access",
    "appointment scheduler", "scheduling coordinator", "patient coordinator",
    "patient intake", "intake coordinator", "medical administrative",
    "medical office assistant", "medical secretary", "medical records",
    "health information", "insurance verification", "eligibility",
    "prior authorization", "medical biller", "medical billing",
    "accounts receivable", "claims processor", "revenue cycle",
    "collections specialist", "referral coordinator", "dental receptionist",
    "patient recall",
]

VALID_SOURCES = {"remotive", "jobicy", "wwr_dom", "linkedin", "indeed", "hn"}

# ── Auth & import helpers ──────────────────────────────────────────────────────

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
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
        return sync_playwright
    except Exception:
        return None


def _log(message: str) -> None:
    """Progress goes to stderr — stdout carries the JSON payload."""
    print(message, file=sys.stderr, flush=True)


def _can_open_browser() -> bool:
    """Whether we can put a real browser window on screen.

    Never on Vercel: a serverless host has no display, and nobody is sitting
    there to click through a challenge. Set INDEED_BROWSER=0 to opt out locally.
    """
    if os.environ.get("VERCEL") == "1":
        return False
    return os.environ.get("INDEED_BROWSER", "1") != "0"


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _uid(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _job(
    source: str,
    url: str,
    title: str,
    company: str,
    location: str = "Remote",
    description: str = "",
    posted_at: str | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "externalId": _uid(url),
        "url": url,
        "title": (title or "").strip(),
        "company": (company or "Unknown").strip(),
        "location": (location or "Remote").strip(),
        "description": (description or f"{title} at {company}").strip(),
        "postedAt": posted_at,
        "raw": {},
    }


def _get(url: str, timeout: int = 12, **kwargs) -> requests.Response:
    return requests.get(
        url, headers=HTTP_HEADERS, timeout=timeout, allow_redirects=True, **kwargs
    )


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)


# ── Playwright scroll helper ───────────────────────────────────────────────────

def _scroll_to_bottom(page, max_ms: int = 18000) -> None:
    import time
    deadline = time.time() + max_ms / 1000
    last_height = 0
    while time.time() < deadline:
        new_height = page.evaluate("() => document.body.scrollHeight")
        if new_height == last_height:
            break
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(1500)
        last_height = new_height


# ── Remotive (requests — public JSON API) ──────────────────────────────────────

def scrape_remotive(limit: int = 200) -> tuple[list[dict[str, Any]], str]:
    queries = [
        "medical+receptionist", "front+desk+receptionist", "patient+coordinator",
        "medical+biller", "medical+billing", "prior+authorization",
        "insurance+verification", "medical+administrative+assistant",
        "patient+intake", "revenue+cycle", "appointment+scheduler",
        "medical+records", "referral+coordinator", "dental+receptionist",
        "scheduling+coordinator",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for q in queries:
        if len(jobs) >= limit:
            break
        try:
            r = _get(
                f"https://remotive.com/api/remote-jobs?search={q}&limit=50",
                timeout=10,
            )
            r.raise_for_status()
            for item in r.json().get("jobs") or []:
                url = item.get("url") or ""
                if not url or url in seen:
                    continue
                seen.add(url)
                jobs.append(_job(
                    source="remotive",
                    url=url,
                    title=item.get("title") or "",
                    company=item.get("company_name") or "",
                    location=item.get("candidate_required_location") or "Remote",
                    description=_strip_html(item.get("description") or "")[:2000],
                    posted_at=item.get("publication_date"),
                ))
        except Exception:
            pass
    return jobs, "requests"


# ── Jobicy (requests — public JSON API) ───────────────────────────────────────

def scrape_jobicy(limit: int = 200) -> tuple[list[dict[str, Any]], str]:
    tags = [
        "healthcare", "medical", "medical-billing", "medical-records",
        "patient-services", "patient-coordinator", "medical-receptionist",
        "prior-authorization", "insurance-verification", "revenue-cycle", "dental",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for tag in tags:
        if len(jobs) >= limit:
            break
        try:
            r = _get(
                f"https://jobicy.com/api/v2/remote-jobs?tag={tag}&count=50",
                timeout=10,
            )
            r.raise_for_status()
            for item in r.json().get("jobs") or []:
                url = item.get("url") or ""
                if not url or url in seen:
                    continue
                seen.add(url)
                jobs.append(_job(
                    source="jobicy",
                    url=url,
                    title=item.get("jobTitle") or "",
                    company=item.get("companyName") or "",
                    location=item.get("jobGeo") or "Remote",
                    description=_strip_html(item.get("jobDescription") or "")[:2000],
                    posted_at=item.get("pubDate"),
                ))
        except Exception:
            pass
    return jobs, "requests"


# ── We Work Remotely (RSS feed — more stable than HTML scraping) ──────────────

def scrape_wwr(limit: int = 200) -> tuple[list[dict[str, Any]], str]:
    import xml.etree.ElementTree as ET
    # Category feeds return consistent listings; search RSS returns empty for
    # medical terms since WWR is tech-focused. LLM filter picks relevant ones.
    category_feeds = [
        "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
        "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
        "https://weworkremotely.com/categories/remote-business-exec-and-management-jobs.rss",
        "https://weworkremotely.com/categories/remote-all-other-jobs.rss",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for feed_url in category_feeds:
        if len(jobs) >= limit:
            break
        try:
            r = _get(feed_url, timeout=12)
            r.raise_for_status()
            try:
                root = ET.fromstring(r.content)
            except ET.ParseError:
                continue
            for item in root.findall(".//item"):
                link_el = item.find("link")
                # <link> in RSS is tricky — text may be after the element
                link = ""
                if link_el is not None:
                    link = (link_el.text or "").strip()
                    if not link and link_el.tail:
                        link = link_el.tail.strip()
                # Fallback to GUID
                if not link:
                    guid_el = item.find("guid")
                    link = (guid_el.text or "").strip() if guid_el is not None else ""
                if not link or link in seen:
                    continue
                seen.add(link)
                raw_title = (item.findtext("title") or "").strip()
                # WWR title format in RSS: "<![CDATA[Company: Job Title]]>" or "Company: Job Title"
                if ":" in raw_title:
                    company, title = raw_title.split(":", 1)
                    company = company.strip()
                    title = title.strip()
                else:
                    title = raw_title
                    company = ""
                region_el = item.find("{https://weworkremotely.com}region")
                region = (region_el.text or "Remote").strip() if region_el is not None else "Remote"
                description = (item.findtext("description") or title).strip()
                description = re.sub(r"<[^>]+>", " ", description)[:500]
                if not title:
                    continue
                jobs.append(_job(
                    source="wwr_dom",
                    url=link,
                    title=title,
                    company=company,
                    location=region,
                    description=description,
                ))
        except Exception:
            pass
    return jobs, "requests"


# ── HN Who's Hiring (requests — Algolia + Firebase) ───────────────────────────

def scrape_hn(limit: int = 100) -> tuple[list[dict[str, Any]], str]:
    try:
        r = _get(
            "https://hn.algolia.com/api/v1/search_by_date"
            "?query=Ask+HN+Who+is+Hiring&tags=ask_hn&hitsPerPage=5",
            timeout=10,
        )
        r.raise_for_status()
        hits = r.json().get("hits") or []
        if not hits:
            return [], "requests"
        thread_id = hits[0].get("objectID") or ""
        if not thread_id:
            return [], "requests"

        r2 = _get(
            f"https://hacker-news.firebaseio.com/v0/item/{thread_id}.json",
            timeout=10,
        )
        r2.raise_for_status()
        kids = (r2.json() or {}).get("kids") or []

        jobs: list[dict[str, Any]] = []
        for kid_id in kids[:200]:
            if len(jobs) >= limit:
                break
            try:
                r3 = _get(
                    f"https://hacker-news.firebaseio.com/v0/item/{kid_id}.json",
                    timeout=5,
                )
                r3.raise_for_status()
                comment = r3.json() or {}
                text = comment.get("text") or ""
                lower = text.lower()
                if not any(kw in lower for kw in MEDICAL_KEYWORDS):
                    continue
                clean = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
                first_line = clean.split("|")[0].split("\n")[0].strip()[:120]
                company = ""
                if "|" in clean:
                    company = clean.split("|")[1].strip()[:80]
                job_url = f"https://news.ycombinator.com/item?id={kid_id}"
                jobs.append(_job(
                    source="hn",
                    url=job_url,
                    title=first_line or "HN Hiring",
                    company=company or "HN Company",
                    location="Remote",
                    description=clean[:2000],
                ))
            except Exception:
                pass
        return jobs, "requests"
    except Exception:
        return [], "requests"


# ── LinkedIn (public guest API — no auth required) ────────────────────────────

def scrape_linkedin(limit: int = 200, query: str | None = None) -> tuple[list[dict[str, Any]], str]:
    queries = [query.strip().replace(" ", "+")] if query else [
        "medical+receptionist", "front+desk+receptionist", "front+office+coordinator",
        "patient+service+representative", "patient+access+representative",
        "appointment+scheduler", "scheduling+coordinator",
        "patient+coordinator", "patient+care+coordinator",
        "patient+intake+specialist", "intake+coordinator",
        "medical+administrative+assistant", "medical+office+assistant",
        "medical+secretary", "medical+records+clerk", "health+information+clerk",
        "data+entry+clerk+medical", "insurance+verification+specialist",
        "eligibility+benefits+verification", "prior+authorization+specialist",
        "authorization+coordinator", "medical+biller", "medical+billing+specialist",
        "accounts+receivable+medical", "claims+processor+medical",
        "revenue+cycle+specialist", "referral+coordinator", "dental+receptionist",
    ]
    import time

    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []

    # The LinkedIn guest API returns ~10 cards per page and paginates by `start`.
    # Fetching only start=0 (the old behaviour) capped every query at ~10 jobs, so
    # walk the pages until one adds nothing (end of results) — up to ~150 per query.
    starts = list(range(0, 150, 10))

    for q in queries:
        if len(jobs) >= limit:
            break
        empty_streak = 0
        for start in starts:
            if len(jobs) >= limit:
                break
            try:
                # f_WT=2 = remote work type, f_TPR=r604800 = past week
                url = (
                    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
                    f"?keywords={q}&location=United+States&f_WT=2&f_TPR=r604800&start={start}"
                )
                r = _get(url, timeout=12)
                r.raise_for_status()
                soup = BeautifulSoup(r.text, "html.parser")

                added = 0
                for li in soup.select("li"):
                    if len(jobs) >= limit:
                        break
                    link = li.select_one("a.base-card__full-link")
                    if not link:
                        continue
                    href = (link.get("href") or "").split("?")[0].strip()
                    if not href or "linkedin.com/jobs/view/" not in href:
                        continue
                    if href in seen:
                        continue
                    seen.add(href)

                    title_el = li.select_one("h3.base-search-card__title")
                    company_el = li.select_one("h4.base-search-card__subtitle")
                    loc_el = li.select_one(".job-search-card__location")

                    title = title_el.get_text(strip=True) if title_el else ""
                    company = company_el.get_text(strip=True) if company_el else ""
                    location = loc_el.get_text(strip=True) if loc_el else "Remote"

                    if not title:
                        continue
                    jobs.append(_job(
                        source="linkedin",
                        url=href,
                        title=title,
                        company=company,
                        location=location,
                    ))
                    added += 1

                # Two consecutive pages with no new cards → end of this query's results.
                if added == 0:
                    empty_streak += 1
                    if empty_streak >= 2:
                        break
                else:
                    empty_streak = 0
                    time.sleep(0.4)  # be polite between pages
            except Exception:
                break
    return jobs, "requests"


# ── Monster (Playwright preferred, requests fallback) ─────────────────────────

def _extract_monster_page(page, seen: set[str]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    cards = page.query_selector_all(
        "article, [data-testid*='job'], [class*='job-card'], [class*='JobCard']"
    )
    for card in cards[:30]:
        link = card.query_selector(
            "a[href*='/job-openings/'], a[href*='/jobs/search/'], a[href]"
        )
        if not link:
            continue
        href = (link.get_attribute("href") or "").strip()
        if not href.startswith("http"):
            href = f"https://www.monster.com{href}"
        if not href or href in seen:
            continue
        seen.add(href)
        title_el = card.query_selector(
            "h2, h3, [data-testid*='title'], [class*='title'], [class*='Title']"
        )
        company_el = card.query_selector(
            "[data-testid*='company'], [class*='company'], [class*='Company'], [class*='employer']"
        )
        loc_el = card.query_selector(
            "[data-testid*='location'], [class*='location'], [class*='Location']"
        )
        title = (title_el.inner_text() if title_el else "").strip()
        company = (company_el.inner_text() if company_el else "").strip()
        location = (loc_el.inner_text() if loc_el else "Remote").strip()
        if not title:
            continue
        jobs.append(_job(source="monster", url=href, title=title, company=company, location=location))
    return jobs


def scrape_monster_playwright(sync_playwright, limit: int = 100) -> list[dict[str, Any]]:
    queries = [
        "Medical+Receptionist", "Patient+Coordinator",
        "Medical+Biller", "Prior+Authorization+Specialist",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        try:
            ctx = browser.new_context(
                user_agent=BROWSER_UA,
                extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
            )
            # Spoof navigator.webdriver so Monster's bot detection doesn't see automation
            ctx.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            for q in queries:
                if len(jobs) >= limit:
                    break
                page = ctx.new_page()
                try:
                    url = f"https://www.monster.com/jobs/search?q={q}&where=Remote&page=1"
                    page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    page.wait_for_timeout(2000)
                    _scroll_to_bottom(page, max_ms=12000)
                    jobs.extend(_extract_monster_page(page, seen))
                except Exception:
                    pass
                finally:
                    page.close()
        finally:
            browser.close()
    return jobs


def scrape_monster_requests(limit: int = 100) -> list[dict[str, Any]]:
    queries = [
        "Medical+Receptionist", "Patient+Coordinator",
        "Medical+Biller", "Prior+Authorization+Specialist",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for q in queries:
        if len(jobs) >= limit:
            break
        try:
            r = _get(
                f"https://www.monster.com/jobs/search?q={q}&where=Remote",
                timeout=12,
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            for card in soup.select("[data-testid*='job'], article")[:20]:
                link = card.select_one("a[href]")
                if not link:
                    continue
                href = link.get("href") or ""
                if not href.startswith("http"):
                    href = f"https://www.monster.com{href}"
                if href in seen:
                    continue
                seen.add(href)
                title_el = card.select_one("h2, h3")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                jobs.append(_job(source="monster", url=href, title=title, company="", location="Remote"))
        except Exception:
            pass
    return jobs


# ── Wellfound (Playwright preferred, requests fallback) ───────────────────────

def _extract_wellfound_json_ld(scripts: list[str], source: str, seen: set[str]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for script_text in scripts:
        try:
            data = json.loads(script_text)
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get("@type") != "JobPosting":
                    continue
                job_url = item.get("url") or ""
                if not job_url or job_url in seen:
                    continue
                seen.add(job_url)
                org = item.get("hiringOrganization") or {}
                loc = item.get("jobLocation") or {}
                addr = loc.get("address") or {} if isinstance(loc, dict) else {}
                location = addr.get("addressLocality") or "Remote" if isinstance(addr, dict) else "Remote"
                jobs.append(_job(
                    source=source,
                    url=job_url,
                    title=item.get("title") or "",
                    company=org.get("name") if isinstance(org, dict) else str(org),
                    location=location,
                    description=_strip_html(item.get("description") or "")[:2000],
                    posted_at=item.get("datePosted"),
                ))
        except Exception:
            pass
    return jobs


def scrape_wellfound_playwright(sync_playwright, limit: int = 100) -> list[dict[str, Any]]:
    queries = [
        "medical+receptionist", "patient+coordinator", "medical+billing",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        try:
            ctx = browser.new_context(
                user_agent=BROWSER_UA,
                extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
            )
            ctx.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            for q in queries:
                if len(jobs) >= limit:
                    break
                page = ctx.new_page()
                try:
                    url = f"https://wellfound.com/jobs?q={q}&remote=true"
                    page.goto(url, wait_until="domcontentloaded", timeout=18000)
                    page.wait_for_timeout(3000)
                    _scroll_to_bottom(page, max_ms=15000)

                    # JSON-LD is most reliable on Wellfound
                    scripts = page.evaluate(
                        "() => Array.from(document.querySelectorAll"
                        "('script[type=\"application/ld+json\"]'))"
                        ".map(s => s.textContent || '')"
                    )
                    found = _extract_wellfound_json_ld(scripts, "wellfound", seen)
                    jobs.extend(found)

                    # If JSON-LD yields nothing, fall back to link cards
                    if not found:
                        links = page.query_selector_all(
                            "a[href*='/company/'][href*='/jobs/'], a[href*='/jobs/']"
                        )
                        for link in links[:30]:
                            href = (link.get_attribute("href") or "").strip()
                            if not href.startswith("http"):
                                href = f"https://wellfound.com{href}"
                            if not href or href in seen or "/jobs/" not in href:
                                continue
                            seen.add(href)
                            parent_text = page.evaluate(
                                "(el) => {"
                                "  const p = el.closest('li, article, div[class*=\"job\"]');"
                                "  return p ? p.innerText : el.innerText;"
                                "}",
                                link,
                            ) or ""
                            lines = [ln.strip() for ln in parent_text.split("\n") if ln.strip()]
                            title = lines[0] if lines else ""
                            company = lines[1] if len(lines) > 1 else ""
                            if not title:
                                continue
                            jobs.append(_job(
                                source="wellfound", url=href,
                                title=title, company=company, location="Remote",
                            ))
                except Exception:
                    pass
                finally:
                    page.close()
        finally:
            browser.close()
    return jobs


def scrape_wellfound_requests(limit: int = 100) -> list[dict[str, Any]]:
    queries = ["medical+receptionist", "patient+coordinator"]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []
    for q in queries:
        if len(jobs) >= limit:
            break
        try:
            r = _get(f"https://wellfound.com/jobs?q={q}&remote=true", timeout=12)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            scripts = [s.string or "" for s in soup.select('script[type="application/ld+json"]')]
            jobs.extend(_extract_wellfound_json_ld(scripts, "wellfound", seen))
        except Exception:
            pass
    return jobs


# ── Indeed (requests + optional Playwright fallback) ──────────────────────────

_INDEED_QUERIES = [
    "medical+receptionist", "front+desk+receptionist", "patient+coordinator",
    "patient+care+coordinator", "patient+intake+specialist",
    "medical+administrative+assistant", "appointment+scheduler",
    "prior+authorization+specialist", "insurance+verification+specialist",
    "medical+biller", "medical+billing+specialist", "revenue+cycle+specialist",
    "accounts+receivable+medical", "referral+coordinator", "dental+receptionist",
]

# Remote work filter: sc=0kf:attr(DSQF7) = Work from Home attribute
_INDEED_URL = (
    "https://www.indeed.com/jobs?q={q}&l=Remote&sort=date&fromage=7"
    "&sc=0kf%3Aattr%28DSQF7%29%3B"
)


def _parse_indeed_page(html: str, seen: set[str]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    soup = BeautifulSoup(html, "html.parser")

    # Try embedded React/mosaic JSON first (fastest, most data)
    for script in soup.select("script"):
        text = script.string or ""
        match = re.search(
            r'window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]+?\});',
            text,
        )
        if not match:
            continue
        try:
            data = json.loads(match.group(1))
            results = (
                (data.get("metaData") or {})
                .get("mosaicProviderJobCardsModel") or {}
            ).get("results") or []
            for item in results:
                job_id = item.get("jobkey") or ""
                title = item.get("displayTitle") or ""
                if not job_id or not title:
                    continue
                url = f"https://www.indeed.com/viewjob?jk={job_id}"
                if url in seen:
                    continue
                seen.add(url)
                city = item.get("jobLocationCity") or ""
                state = item.get("jobLocationState") or ""
                location = ", ".join(filter(None, [city, state])) or "Remote"
                pub_ms = item.get("pubDate")
                posted_at = None
                if isinstance(pub_ms, (int, float)):
                    from datetime import datetime, timezone
                    posted_at = datetime.fromtimestamp(pub_ms / 1000, tz=timezone.utc).isoformat()
                jobs.append(_job(
                    source="indeed",
                    url=url,
                    title=title,
                    company=item.get("company") or "",
                    location=location,
                    description=item.get("snippet") or title,
                    posted_at=posted_at,
                ))
        except Exception:
            pass
        if jobs:
            return jobs

    # Fallback: parse visible HTML job cards
    for card in soup.select("[data-testid='slider_item'], .job_seen_beacon, .tapItem"):
        link = card.select_one("h2.jobTitle a, [data-testid='jobTitle'] a")
        href = (link.get("href") or "") if link else ""
        if not href:
            href = (card.select_one("a[href*='/rc/clk']") or {}).get("href") or ""
        if not href:
            continue
        if href.startswith("/"):
            href = f"https://www.indeed.com{href}"
        if href in seen:
            continue
        seen.add(href)
        title_el = card.select_one("h2.jobTitle, [data-testid='jobTitle']")
        title = title_el.get_text(strip=True) if title_el else ""
        if not title:
            continue
        company_el = card.select_one(".companyName, [data-testid='company-name']")
        loc_el = card.select_one(".companyLocation, [data-testid='text-location']")
        jobs.append(_job(
            source="indeed",
            url=href,
            title=title,
            company=(company_el.get_text(strip=True) if company_el else ""),
            location=(loc_el.get_text(strip=True) if loc_el else "Remote"),
        ))
    return jobs


# Single-position search (USA, most recent first).
_INDEED_QUERY_URL = "https://www.indeed.com/jobs?q={q}&l=USA&sort=date"


def _indeed_queries(query: str | None) -> list[str]:
    return [query.strip().replace(" ", "+")] if query else _INDEED_QUERIES


def _indeed_url(q: str, query: str | None) -> str:
    return _INDEED_QUERY_URL.format(q=q) if query else _INDEED_URL.format(q=q)


def scrape_indeed_requests(limit: int = 200, query: str | None = None) -> list[dict[str, Any]]:
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []

    # Prefer curl_cffi: it impersonates Chrome's TLS fingerprint so Indeed's
    # bot-detection sees a real browser rather than a Python HTTP client.
    _cffi_session = None
    try:
        from curl_cffi import requests as _cffi  # type: ignore
        _cffi_session = _cffi.Session(impersonate="chrome")
    except Exception:
        pass

    for q in _indeed_queries(query):
        if len(jobs) >= limit:
            break
        try:
            url = _indeed_url(q, query)
            if _cffi_session is not None:
                r = _cffi_session.get(
                    url, headers=HTTP_HEADERS, timeout=14, allow_redirects=True
                )
            else:
                r = _get(url, timeout=14)
            if r.status_code == 403:
                break
            r.raise_for_status()
            found = _parse_indeed_page(r.text, seen)
            jobs.extend(found)
        except Exception:
            pass
    return jobs


# Trim the most obvious headless-automation tells before Indeed's page scripts run.
_STEALTH_JS = """
Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
window.chrome={runtime:{}};
"""


# Chromium profile that keeps Indeed's Cloudflare cookies (`cf_clearance`) between
# runs, so a challenge cleared once isn't re-armed on every scrape.
_INDEED_PROFILE_DIR = os.path.join(os.getcwd(), ".playwright", "indeed")

# Ceiling on how long to sit on the search page waiting for the Cloudflare check
# to clear. Measured at 13-15s, so a hard 15s cutoff flakes; we wait longer but
# return the instant job cards appear, so the common case still costs ~14s.
_INDEED_VERIFY_WAIT = int(os.environ.get("INDEED_VERIFY_WAIT", "45"))

# Job cards. Their presence is what tells us the challenge is behind us.
_INDEED_CARDS = ".job_seen_beacon, [data-testid='slider_item']"


def _page_html(page, attempts: int = 5) -> str:
    """page.content() throws while the challenge page is mid-redirect. Retry."""
    for _ in range(attempts):
        try:
            return page.content()
        except Exception:
            page.wait_for_timeout(500)
    return ""


def scrape_indeed_playwright(
    sync_playwright,
    limit: int = 200,
    query: str | None = None,
    verify_wait: int = _INDEED_VERIFY_WAIT,
) -> list[dict[str, Any]]:
    """Scrape Indeed through a real, on-screen Chromium.

    Indeed fronts its results with a Cloudflare check that takes ~13-15s to
    clear. Two things about it drive this design:

      * It will not clear in a headless browser. Headless gets served a flat
        "Blocked - Indeed.com" even when the profile already holds a valid
        `cf_clearance` cookie, so the window has to be real and on screen.
      * The challenge page redirects itself while it works, which makes
        page.content() raise. Polling content() (what we used to do) therefore
        looked like "no jobs found" rather than "still loading" — and with only
        an 8s budget it gave up ~5s before the page was ever going to be ready.
        Waiting on the job-card selector instead rides out the redirects.

    Usually nobody has to touch the window. If Cloudflare does escalate to a
    click-through, it's on screen and the wait is long enough to solve it by hand.
    """
    queries = _indeed_queries(query) if query else [
        "medical+receptionist", "patient+coordinator",
        "prior+authorization+specialist", "medical+biller",
        "insurance+verification+specialist", "medical+administrative+assistant",
    ]
    seen: set[str] = set()
    jobs: list[dict[str, Any]] = []

    os.makedirs(_INDEED_PROFILE_DIR, exist_ok=True)

    with sync_playwright() as p:
        # Everything here is deliberately minimal — each thing we used to "help"
        # with is a Cloudflare tell, and adding any of them back pins the page on
        # "Just a moment..." forever (all verified against the live site):
        #   * user_agent=BROWSER_UA — claims macOS while the browser is really
        #     Windows/Linux, and Cloudflare cross-checks UA against the platform.
        #   * _STEALTH_JS — patching navigator.webdriver is itself detectable.
        #   * --no-sandbox / --disable-dev-shm-usage — classic automation flags.
        # A stock Chromium, left alone, clears the check on its own in ~15s.
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=_INDEED_PROFILE_DIR,
            headless=False,
            viewport={"width": 1366, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            for i, q in enumerate(queries):
                if len(jobs) >= limit:
                    break
                try:
                    page.goto(_indeed_url(q, query), wait_until="domcontentloaded", timeout=30_000)
                    if i == 0:
                        _log(
                            f"Indeed: waiting up to {verify_wait}s for the verification check "
                            f"to clear. If it asks you to click something, do it in the "
                            f"browser window that just opened."
                        )
                    page.wait_for_selector(_INDEED_CARDS, timeout=verify_wait * 1000)
                    jobs.extend(_parse_indeed_page(_page_html(page), seen))
                except Exception:
                    # This query didn't come through; the next one may still.
                    _log(f"Indeed: no results for {q!r} (page title: {page.title()[:40]!r})")
        finally:
            ctx.close()
    return jobs


def scrape_indeed(limit: int = 200, query: str | None = None) -> tuple[list[dict[str, Any]], str]:
    """Real browser first; curl_cffi only where we can't open one.

    The browser MUST go first. curl_cffi gets a 403 + CAPTCHA whenever the
    Cloudflare check is armed, and that failed request arms it harder against
    this IP — so the browser we opened right afterwards was being held on the
    challenge because of our own probe. Trying the "cheap" path first was
    poisoning the path that actually works, on every run and on any IP.

    A browser needs a display, so on Vercel curl_cffi is all there is. When the
    check is armed there, Indeed simply cannot be scraped server-side; run it
    locally, where the window can open.
    """
    if _can_open_browser():
        sync_playwright = _try_playwright_import()
        if sync_playwright:
            jobs = scrape_indeed_playwright(sync_playwright, limit, query)
            if jobs:
                return jobs, "playwright"

    jobs = scrape_indeed_requests(limit, query)
    return (jobs, "requests") if jobs else ([], "none")


# ── Dispatcher ────────────────────────────────────────────────────────────────

def scrape_source(source: str, query: str | None = None) -> tuple[list[dict[str, Any]], str]:
    if source == "remotive":
        return scrape_remotive()
    if source == "jobicy":
        return scrape_jobicy()
    if source == "wwr_dom":
        return scrape_wwr()
    if source == "hn":
        return scrape_hn()
    if source == "linkedin":
        return scrape_linkedin(query=query)
    if source == "indeed":
        return scrape_indeed(query=query)
    return [], "none"


# ── Vercel handler ─────────────────────────────────────────────────────────────

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

        source = (payload.get("source") or "").strip()
        if source not in VALID_SOURCES:
            self._respond(400, {"error": f"Unknown source: {source!r}. Valid: {sorted(VALID_SOURCES)}"})
            return
        query = (payload.get("query") or "").strip() or None

        try:
            jobs, engine = scrape_source(source, query)
            self._respond(200, {"ok": True, "jobs": jobs, "engine": engine, "count": len(jobs)})
        except Exception as exc:
            self._respond(500, {"ok": False, "error": str(exc)[:300]})

    def _respond(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(encoded)


# ── CLI subprocess entry-point (used by TypeScript route in local dev) ─────────

if __name__ == "__main__":
    import sys
    src = sys.argv[1] if len(sys.argv) > 1 else ""
    cli_query = sys.argv[2] if len(sys.argv) > 2 else None
    if src not in VALID_SOURCES:
        print(json.dumps({"ok": False, "error": f"Unknown source: {src!r}"}))
        sys.exit(1)
    try:
        found, eng = scrape_source(src, cli_query)
        print(json.dumps({"ok": True, "jobs": found, "engine": eng, "count": len(found)}))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:300]}))
        sys.exit(1)
