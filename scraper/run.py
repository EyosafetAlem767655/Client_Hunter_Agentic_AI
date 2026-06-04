#!/usr/bin/env python3
"""Run all Python scrapers and output JSON."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from scrapers.hn_hiring import HnHiringScraper  # noqa: E402
from scrapers.remoteok import RemoteOkScraper  # noqa: E402
from scrapers.weworkremotely import WeWorkRemotelyScraper  # noqa: E402


def run_scrapers(limit: int, contact_email: str) -> dict:
    scrapers = [
        RemoteOkScraper(contact_email),
        WeWorkRemotelyScraper(contact_email),
        HnHiringScraper(contact_email),
    ]

    all_postings: list[dict] = []
    errors: list[dict] = []

    for scraper in scrapers:
        try:
            batch = scraper.fetch(limit)
            all_postings.extend(batch)
            errors.append(
                {"source": scraper.source, "ok": True, "count": len(batch)}
            )
        except Exception as exc:
            errors.append(
                {
                    "source": scraper.source,
                    "ok": False,
                    "error": str(exc),
                }
            )

    return {
        "postings": all_postings[: limit * 3],
        "scraped": len(all_postings),
        "sources": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument(
        "--contact-email",
        default=os.environ.get("CONTACT_EMAIL", "contact@talentbridge.example"),
    )
    args = parser.parse_args()

    result = run_scrapers(args.limit, args.contact_email)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
