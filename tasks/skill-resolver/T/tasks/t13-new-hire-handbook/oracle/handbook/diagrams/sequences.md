# Sequence Diagrams

## Workflow: Enqueue a job

Runs when service code or the CLI adds work.

```mermaid
sequenceDiagram
    participant Caller
    participant Queue
    participant SqliteStore
    Caller->>Queue: enqueue(name, payload)
    Queue->>SqliteStore: insert(name, payload)
    SqliteStore-->>Queue: job id
    Queue-->>Caller: job id
```

## Workflow: Process one job

Runs on every iteration of the worker loop.

```mermaid
sequenceDiagram
    participant Worker
    participant SqliteStore
    participant Handler
    Worker->>SqliteStore: claim_next()
    SqliteStore-->>Worker: Job (status running)
    Worker->>Handler: handler(payload)
    alt handler succeeds
        Worker->>SqliteStore: set_status(id, done)
    else handler raises
        Worker->>SqliteStore: set_status(id, queued or failed)
    end
```

### Walkthrough

1. **Claim**: `storage.py:SqliteStore.claim_next`
2. **Run and record**: `worker.py:Worker.run_once`
