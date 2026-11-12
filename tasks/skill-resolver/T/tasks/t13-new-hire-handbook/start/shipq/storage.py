import json
import sqlite3

from .models import Job


class SqliteStore:
    def __init__(self, path: str):
        self.conn = sqlite3.connect(path)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, name TEXT, payload TEXT, attempts INTEGER, status TEXT)"
        )

    def insert(self, name: str, payload: dict) -> int:
        cur = self.conn.execute(
            "INSERT INTO jobs (name, payload, attempts, status) VALUES (?, ?, 0, 'queued')", (name, json.dumps(payload))
        )
        self.conn.commit()
        return cur.lastrowid

    def claim_next(self) -> Job | None:
        row = self.conn.execute("SELECT id, name, payload, attempts FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").fetchone()
        if row is None:
            return None
        self.conn.execute("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?", (row[0],))
        self.conn.commit()
        return Job(id=row[0], name=row[1], payload=json.loads(row[2]), attempts=row[3] + 1, status="running")

    def set_status(self, job_id: int, status: str) -> None:
        self.conn.execute("UPDATE jobs SET status = ? WHERE id = ?", (status, job_id))
        self.conn.commit()
