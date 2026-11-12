# Modules

| File | What it does |
|---|---|
| `shipq/models.py` | `Job` dataclass: id, name, payload, attempts, status. |
| `shipq/storage.py` | `SqliteStore`: creates the table, `insert`, `claim_next`, `set_status`. |
| `shipq/queue.py` | `Queue`: handler registry (`register`) and `enqueue`. |
| `shipq/worker.py` | `Worker`: `run_once`, `run_forever`, retry limit `MAX_ATTEMPTS = 3`. |
| `shipq/cli.py` | `shipq enqueue` and `shipq work`. |
