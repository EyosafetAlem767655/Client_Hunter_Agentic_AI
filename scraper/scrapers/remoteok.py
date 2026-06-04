from typing import Any

from .base import BaseScraper


class RemoteOkScraper(BaseScraper):
    def __init__(self, contact_email: str):
        super().__init__("remoteok", contact_email)

    def fetch(self, limit: int) -> list[dict[str, Any]]:
        origin = "https://remoteok.com"
        if not self._respect_robots(origin, "/api"):
            return []

        response = self._fetch_with_retry(f"{origin}/api")
        data = response.json()
        jobs = data[1 : limit + 1] if isinstance(data, list) else []

        postings: list[dict[str, Any]] = []
        for job in jobs:
            external_id = str(job.get("id") or job.get("slug") or "")
            slug = job.get("slug") or external_id
            postings.append(
                {
                    "source": "remoteok",
                    "externalId": external_id,
                    "url": job.get("url") or f"{origin}/remote-jobs/{slug}",
                    "title": job.get("position") or "Unknown role",
                    "company": job.get("company") or "Unknown company",
                    "location": job.get("location") or "Remote",
                    "description": job.get("description") or "",
                    "postedAt": job.get("date"),
                    "raw": job,
                }
            )
        return postings
