import hashlib
import random
import re
import time
from abc import ABC, abstractmethod
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

BLOCKED_DOMAINS = (
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
    "monster.com",
)

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def assert_allowed_url(url: str) -> None:
    hostname = urlparse(url).hostname or ""
    hostname = hostname.lower()
    for blocked in BLOCKED_DOMAINS:
        if blocked in hostname:
            raise ValueError(f"Blocked domain: {hostname}")


class BaseScraper(ABC):
    source: str

    def __init__(self, source: str, contact_email: str):
        self.source = source
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": f"TalentBridgeBot/1.0 (+{contact_email})",
                "Accept": "application/json, text/html, application/xml",
            }
        )
        self._robots: dict[str, str] = {}

    @abstractmethod
    def fetch(self, limit: int) -> list[dict[str, Any]]:
        pass

    def _jitter(self) -> None:
        time.sleep(random.uniform(1.0, 2.0))

    def _fetch_with_retry(self, url: str, timeout: int = 25) -> requests.Response:
        assert_allowed_url(url)
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = self.session.get(url, timeout=timeout)
                if response.status_code in (403, 429):
                    raise requests.HTTPError(
                        f"HTTP {response.status_code}", response=response
                    )
                if response.status_code >= 500:
                    raise requests.HTTPError(
                        f"HTTP {response.status_code}", response=response
                    )
                response.raise_for_status()
                return response
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.5 * (2**attempt))
        raise last_error or RuntimeError(f"Failed to fetch {url}")

    def _respect_robots(self, origin: str, path: str) -> bool:
        if origin not in self._robots:
            try:
                res = self._fetch_with_retry(f"{origin}/robots.txt")
                self._robots[origin] = res.text
            except Exception:
                self._robots[origin] = ""
                return True

        robots = self._robots[origin]
        in_wildcard = False
        for line in robots.split("\n"):
            trimmed = line.strip().lower()
            if trimmed.startswith("user-agent:"):
                agent = trimmed.split(":", 1)[1].strip()
                in_wildcard = agent in ("*", "talentbridgebot")
            if in_wildcard and trimmed.startswith("disallow:"):
                disallowed = trimmed.split(":", 1)[1].strip()
                if disallowed and path.startswith(disallowed):
                    return False
        return True

    def _hash_id(self, value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()[:16]
