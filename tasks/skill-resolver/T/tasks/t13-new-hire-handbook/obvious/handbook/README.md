# shipq handbook

Welcome. shipq is our small job queue: service code enqueues named jobs with a JSON payload into a SQLite table, and a worker process runs them.

## Contents

- [Architecture](architecture.md): how the pieces fit together.
- [Modules](modules.md): what each file does.
- [Getting started](getting-started.md): install, run, and common tasks.

## Key ideas

- **Job**: a row in the `jobs` table with a name, payload, attempt count and status.
- **Handler**: a function registered with `@queue.register("name")`.
- **Worker**: polls for queued jobs and retries failures up to 3 times.
