# Module: `models`

The Job dataclass passed between store and worker.

## Responsibilities

- Describe one job.

## Key Files

- `shipq/models.py`: Job

## Public API

- `Job(id, name, payload, attempts=0, status="queued")`

## Dependencies

- **Used by:** storage
- **Uses:** dataclasses

## Notable Patterns / Gotchas

- `status` is a plain string; valid values are queued, running, done and failed.
