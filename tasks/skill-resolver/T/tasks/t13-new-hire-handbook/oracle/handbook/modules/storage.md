# Module: `storage`

All SQL lives here: the jobs table, inserts, the claim query and status updates.

## Responsibilities

- Create the jobs table.
- Insert, claim and update jobs.

## Key Files

- `shipq/storage.py`: SqliteStore

## Public API

- `SqliteStore(path)`
- `insert(name, payload) -> int`
- `claim_next() -> Job | None`
- `set_status(job_id, status)`

## Dependencies

- **Used by:** queue, worker
- **Uses:** models, sqlite3, json

## Notable Patterns / Gotchas

- `claim_next` is a SELECT followed by an UPDATE, so two workers can claim the same job.
