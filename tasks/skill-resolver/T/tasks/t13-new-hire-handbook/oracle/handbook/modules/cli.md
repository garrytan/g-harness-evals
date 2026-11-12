# Module: `cli`

The `shipq` command line.

## Responsibilities

- Parse `enqueue` and `work` subcommands.
- Build a Queue for the given database.

## Key Files

- `shipq/cli.py`: main()

## Public API

- `main()`: entry point declared in pyproject.toml

## Dependencies

- **Used by:** users
- **Uses:** queue, worker

## Notable Patterns / Gotchas

- `shipq work` registers no handlers, so it only works for job names that some import registered.
