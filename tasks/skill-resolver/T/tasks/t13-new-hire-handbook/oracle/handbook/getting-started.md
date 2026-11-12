# Getting Started

## Prerequisites

Python 3.11 or later (from pyproject.toml). No other dependencies.

## Installation

```bash
pip install -e .
```

## First Run

```bash
shipq enqueue send_email '{"to": "a@example.com"}'
shipq work --db jobs.db
```

The CLI worker has no handlers registered, so in practice you run a worker from your own code after registering handlers.

## Configuration

- `--db`: path to the SQLite file (default `jobs.db`).
- `MAX_ATTEMPTS` in `shipq/worker.py`: retry limit (3).

## Where to Go Next

- Architecture: [architecture.md](architecture.md)
- Module reference: [README.md#module-map](README.md#module-map)
