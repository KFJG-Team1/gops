from __future__ import annotations

import logging
import os
import socket
import threading
import time

from gops_agents.czardas_assets.builder import CzardasAssetBuilder
from gops_agents.czardas_assets.queue import build_czardas_queue_from_env


LOGGER = logging.getLogger(__name__)


def run() -> None:
    worker_id = f"{socket.gethostname()}-{os.getpid()}"
    queue = build_czardas_queue_from_env()
    builder = CzardasAssetBuilder()
    while True:
        claim = queue.claim_next(worker_id, lease_seconds=120)
        if claim is None:
            time.sleep(1.0)
            continue
        try:
            process_claim(builder, queue, claim, worker_id)
        except Exception:
            LOGGER.exception("Czardas build item failed outside its item boundary")
            try:
                queue.record_outer_failure(claim["envelope"].job_id, worker_id)
            except Exception:
                # The expired-lease reaper in claim_next is the durable fallback
                # when PostgreSQL itself caused the boundary failure.
                LOGGER.exception("Czardas failed claim could not be released")


def process_claim(builder, queue, claim: dict, worker_id: str) -> dict:
    stopped = threading.Event()

    def heartbeat() -> None:
        while not stopped.wait(30.0):
            if not queue.heartbeat(claim["envelope"].job_id, worker_id, lease_seconds=120):
                return

    thread = threading.Thread(target=heartbeat, name="czardas-lease", daemon=True)
    thread.start()
    try:
        return builder.run_item(claim["envelope"], claim["symbol"], claim["interval"])
    finally:
        stopped.set()
        thread.join(timeout=1.0)


if __name__ == "__main__":
    run()
