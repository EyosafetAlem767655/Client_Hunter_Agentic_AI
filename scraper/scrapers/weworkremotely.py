from typing import Any
from xml.etree import ElementTree

from .base import BaseScraper

FEEDS = [
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-design-jobs.rss",
    "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
    "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    "https://weworkremotely.com/categories/remote-sales-marketing-jobs.rss",
]


class WeWorkRemotelyScraper(BaseScraper):
    def __init__(self, contact_email: str):
        super().__init__("weworkremotely", contact_email)

    def fetch(self, limit: int) -> list[dict[str, Any]]:
        postings: list[dict[str, Any]] = []

        for feed_url in FEEDS:
            if len(postings) >= limit:
                break

            from urllib.parse import urlparse

            parsed = urlparse(feed_url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            if not self._respect_robots(origin, parsed.path):
                continue

            self._jitter()
            response = self._fetch_with_retry(feed_url)
            root = ElementTree.fromstring(response.content)

            for item in root.findall(".//item"):
                if len(postings) >= limit:
                    break

                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                description = (item.findtext("description") or "").strip()
                pub_date = (item.findtext("pubDate") or "").strip()
                guid = (item.findtext("guid") or link).strip()
                company = title.split(":")[0].strip() if ":" in title else "Unknown"
                role_title = (
                    title.split(":", 1)[1].strip() if ":" in title else title
                )

                postings.append(
                    {
                        "source": "weworkremotely",
                        "externalId": self._hash_id(guid),
                        "url": link,
                        "title": role_title,
                        "company": company,
                        "location": "Remote",
                        "description": description,
                        "postedAt": pub_date or None,
                        "raw": {
                            "title": title,
                            "link": link,
                            "description": description,
                            "pubDate": pub_date,
                            "guid": guid,
                        },
                    }
                )

        return postings[:limit]
