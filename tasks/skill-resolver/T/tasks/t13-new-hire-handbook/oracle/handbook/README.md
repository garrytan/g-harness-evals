# shipq

shipq is a small job queue for Python services that keeps its jobs in one SQLite table. Code enqueues a named job with a JSON payload; a worker process polls the table, runs the handler registered for that name, and retries a failing job up to three times.

## Key Concepts

- **Job**: one row in the `jobs` table: name, JSON payload, attempt count, status (queued, running, done, failed).
- **Handler**: a function registered on a Queue under a job name with `@queue.register("name")`.
- **Worker**: a loop that claims the oldest queued job and runs its handler.

## Entry Points

- `shipq/cli.py`: the `shipq` command (`enqueue` and `work`).
- `shipq/__init__.py`: the library surface: Job, Queue, Worker.

## High-Level Architecture

The CLI and library code share one Queue object, which owns a SqliteStore. The Worker reads from the same store. See [architecture.md](architecture.md).

## Module Map

| Module | Purpose |
|---|---|
| [`queue`](modules/queue.md) | Handler registry and enqueue |
| [`worker`](modules/worker.md) | Polling loop, retries, status updates |
| [`storage`](modules/storage.md) | SQLite table and the claim query |
| [`cli`](modules/cli.md) | The shipq command |
| [`models`](modules/models.md) | The Job dataclass |

## Getting Started

See [getting-started.md](getting-started.md).
