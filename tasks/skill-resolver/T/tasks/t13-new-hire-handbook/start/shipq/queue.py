from typing import Callable

from .storage import SqliteStore


class Queue:
    def __init__(self, db_path: str):
        self.store = SqliteStore(db_path)
        self.handlers: dict[str, Callable[[dict], None]] = {}

    def register(self, name: str):
        def decorator(fn: Callable[[dict], None]):
            self.handlers[name] = fn
            return fn
        return decorator

    def enqueue(self, name: str, payload: dict) -> int:
        return self.store.insert(name, payload)
