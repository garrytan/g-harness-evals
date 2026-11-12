import time

from .queue import Queue

MAX_ATTEMPTS = 3


class Worker:
    def __init__(self, queue: Queue, poll_seconds: float = 1.0):
        self.queue = queue
        self.poll_seconds = poll_seconds

    def run_once(self) -> bool:
        job = self.queue.store.claim_next()
        if job is None:
            return False
        handler = self.queue.handlers[job.name]
        try:
            handler(job.payload)
            self.queue.store.set_status(job.id, "done")
        except Exception:
            status = "failed" if job.attempts >= MAX_ATTEMPTS else "queued"
            self.queue.store.set_status(job.id, status)
        return True

    def run_forever(self) -> None:
        while True:
            if not self.run_once():
                time.sleep(self.poll_seconds)
