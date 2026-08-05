"""Local Indeed worker for a Vercel deployment.

The worker polls the Vercel queue, opens an installed browser through the
existing Playwright scraper, then uploads results. It requires no inbound port.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import sys
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.py.scrape_jobs import scrape_indeed  # noqa: E402


def request_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def post_failure(base_url: str, token: str, job_id: int, error: str) -> None:
    try:
        requests.post(
            f"{base_url}/api/worker/indeed/{job_id}",
            headers=request_headers(token),
            json={"ok": False, "error": error[:1000]},
            timeout=30,
        ).raise_for_status()
    except Exception as exc:
        print(f"Could not report failure for queue job {job_id}: {exc}", file=sys.stderr)


def run_job(base_url: str, token: str, job: dict[str, Any]) -> None:
    job_id = int(job["id"])
    query = job.get("query") or None
    print(f"Claimed Indeed queue job {job_id} (query={query or 'all configured roles'!r})")
    try:
        jobs, engine = scrape_indeed(limit=200, query=query)
        if not jobs:
            raise RuntimeError("Browser opened but Indeed returned no job cards")
        response = requests.post(
            f"{base_url}/api/worker/indeed/{job_id}",
            headers=request_headers(token),
            json={"ok": True, "jobs": jobs},
            timeout=90,
        )
        response.raise_for_status()
        result = response.json().get("job") or {}
        print(
            f"Completed queue job {job_id}: {result.get('fetched', len(jobs))} accepted, "
            f"{result.get('inserted', 0)} new (engine={engine})"
        )
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        print(f"Queue job {job_id} failed: {message}", file=sys.stderr)
        post_failure(base_url, token, job_id, message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Poll Vercel and scrape queued Indeed jobs locally")
    parser.add_argument("--url", default=os.environ.get("TALENTBRIDGE_URL"))
    parser.add_argument("--token", default=os.environ.get("INDEED_WORKER_TOKEN") or os.environ.get("ADMIN_TOKEN"))
    parser.add_argument("--interval", type=max_one, default=5, help="Polling interval in seconds")
    parser.add_argument("--once", action="store_true", help="Poll once, then exit")
    args = parser.parse_args()
    if not args.url or not args.token:
        parser.error("set --url and --token (or TALENTBRIDGE_URL and INDEED_WORKER_TOKEN)")

    base_url = args.url.rstrip("/")
    worker_id = f"{platform.node() or socket.gethostname()}-{os.getpid()}"
    print(f"Indeed worker {worker_id} polling {base_url}. Press Ctrl+C to stop.")
    while True:
        try:
            response = requests.get(
                f"{base_url}/api/worker/indeed/next",
                params={"workerId": worker_id},
                headers=request_headers(args.token),
                timeout=30,
            )
            if response.status_code == 204:
                if args.once:
                    print("No queued Indeed jobs.")
                    return 0
            else:
                response.raise_for_status()
                run_job(base_url, args.token, response.json()["job"])
                if args.once:
                    return 0
        except KeyboardInterrupt:
            print("\nWorker stopped.")
            return 0
        except Exception as exc:
            print(f"Queue poll failed: {exc}", file=sys.stderr)
            if args.once:
                return 1
        time.sleep(args.interval)


def max_one(value: str) -> int:
    return max(1, int(value))


if __name__ == "__main__":
    raise SystemExit(main())
