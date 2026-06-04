import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scraper"))

from run import run_scrapers  # noqa: E402


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
    def do_GET(self):
        if not _authorized(self.headers):
            self.send_response(401)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return

        query = parse_qs(urlparse(self.path).query)
        limit = int(query.get("limit", ["50"])[0])
        contact = os.environ.get("CONTACT_EMAIL", "contact@talentbridge.example")

        try:
            result = run_scrapers(limit, contact)
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
