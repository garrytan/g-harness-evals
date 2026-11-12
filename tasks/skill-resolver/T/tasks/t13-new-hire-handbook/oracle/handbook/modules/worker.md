# Module: `worker`

Polls for queued jobs, runs handlers and records the outcome.

## Responsibilities

- Claim the next job.
- Run its handler and set done, queued or failed.
- Sleep when the queue is empty.

## Key Files

- `shipq/worker.py`: Worker and MAX_ATTEMPTS

## Public API

- `Worker(queue, poll_seconds=1.0)`
- `Worker.run_once() -> bool`
- `Worker.run_forever()`

## Dependencies

- **Used by:** cli
- **Uses:** queue, storage

## Notable Patterns / Gotchas

- A job name with no handler raises KeyError outside the try block and stops the loop.
- A failing job is set back to queued until attempts reach 3.
