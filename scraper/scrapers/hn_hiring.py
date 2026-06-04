import re
from typing import Any

from .base import BaseScraper


class HnHiringScraper(BaseScraper):
    def __init__(self, contact_email: str):
        super().__init__("hn", contact_email)

    def fetch(self, limit: int) -> list[dict[str, Any]]:
        search_url = (
            "https://hn.algolia.com/api/v1/search?query=who+is+hiring&tags=story"
        )
        search_res = self._fetch_with_retry(search_url)
        hits = search_res.json().get("hits") or []
        if not hits:
            return []

        latest_id = hits[0].get("objectID")
        self._jitter()
        thread_res = self._fetch_with_retry(
            f"https://hn.algolia.com/api/v1/items/{latest_id}"
        )
        thread = thread_res.json()

        postings: list[dict[str, Any]] = []

        def walk(comments: list[dict[str, Any]] | None) -> None:
            if not comments or len(postings) >= limit:
                return
            for comment in comments:
                if len(postings) >= limit:
                    return
                text = comment.get("text") or ""
                if len(text) < 40:
                    walk(comment.get("children"))
                    continue

                title_match = re.search(r"(?:^|\|)\s*([^|]+?)\s*\|", text)
                title = (
                    title_match.group(1).strip()
                    if title_match
                    else f"HN comment {comment.get('id')}"
                )
                clean = re.sub(r"<[^>]+>", " ", text)
                postings.append(
                    {
                        "source": "hn",
                        "externalId": str(comment.get("id")),
                        "url": f"https://news.ycombinator.com/item?id={comment.get('id')}",
                        "title": title,
                        "company": comment.get("author") or "unknown",
                        "location": "Remote",
                        "description": clean,
                        "postedAt": comment.get("created_at_i"),
                        "raw": {
                            "id": comment.get("id"),
                            "author": comment.get("author"),
                            "text": text,
                        },
                    }
                )
                walk(comment.get("children"))

        walk(thread.get("children"))
        return postings[:limit]
