from dataclasses import dataclass


@dataclass
class Job:
    id: int
    name: str
    payload: dict
    attempts: int = 0
    status: str = "queued"
