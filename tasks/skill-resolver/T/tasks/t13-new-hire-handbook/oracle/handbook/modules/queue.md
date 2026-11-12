# Module: `queue`

Holds the handler registry and turns enqueue calls into rows.

## Responsibilities

- Register handlers by job name.
- Insert new jobs through the store.

## Key Files

- `shipq/queue.py`: the Queue class

## Public API

- `Queue(db_path)`
- `Queue.register(name)`: decorator
- `Queue.enqueue(name, payload) -> int`

## Dependencies

- **Used by:** cli, worker
- **Uses:** storage

## Notable Patterns / Gotchas

- Handlers are in memory only; a worker in another process does not see handlers registered elsewhere.
