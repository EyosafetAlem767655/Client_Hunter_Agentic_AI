"""POST /api/py/langsearch_urls

Search LangSearch for likely contact-page URLs for a company.

The request body accepts:
  { "company": "CRAE GROUP LTD", "count": 5 }

The response normalizes LangSearch's `data.webPages.value` or top-level
`results` shape into:
  { "results": [{ "title", "url", "displayUrl", "snippet", "summary" }] }
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler
from typing import Any

import requests


LANGSEARCH_API_URL = "https://api.langsearch.com/v1/web-search"
TIMEOUT_SECONDS = 15


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


def _raw_results(payload: dict[str, Any]) -> list[Any]:
    top_level = payload.get("results")
    if isinstance(top_level, list):
        return top_level

    nested = (
        payload.get("data", {})
        .get("webPages", {})
        .get("value", [])
    )
    if isinstance(nested, list):
        return nested
    return []


def _first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            return value
    return ""


def _parse_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    value = _raw_results(payload)

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith("http"):
            continue
        if url in seen:
            continue
        seen.add(url)
        results.append(
            {
                "title": _first_string(item.get("title"), item.get("name")),
                "url": url,
                "displayUrl": _first_string(item.get("displayUrl"), url),
                "snippet": _first_string(item.get("snippet")),
                "summary": _first_string(item.get("summary")),
            }
        )
    return results


def search_contact_urls(company: str, count: int = 5) -> dict[str, Any]:
    api_key = (os.environ.get("LANGSEARCH_API_KEY") or "").strip()
    if not api_key:
        return {"results": [], "error": "LANGSEARCH_API_KEY is not set"}

    payload = {
        "query": f"contact us URL for {company}",
        "freshness": "noLimit",
        "summary": True,
        "count": max(1, min(count, 10)),
    }
    response = requests.post(
        LANGSEARCH_API_URL,
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    raw = response.json()
    return {
        "results": _parse_results(raw),
        "query": payload["query"],
        "logId": raw.get("log_id"),
        "code": raw.get("code"),
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
            raw_body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw_body or b"{}")
        except Exception as exc:
            self.send_response(400)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": f"Bad JSON: {exc}"}).encode()
            )
            return

        company = payload.get("company")
        if not isinstance(company, str) or len(company.strip()) < 2:
            self.send_response(400)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": "company string is required"}).encode()
            )
            return

        count = payload.get("count", 5)
        if not isinstance(count, int):
            count = 5

        try:
            result = search_contact_urls(company.strip(), count)
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self.send_response(502)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(exc)[:300]}).encode())
