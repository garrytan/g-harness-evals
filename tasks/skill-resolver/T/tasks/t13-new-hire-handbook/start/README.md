# shipq

A tiny SQLite-backed job queue for Python services.

    pip install -e .
    shipq enqueue send_email '{"to": "a@example.com"}'
    shipq work --db jobs.db
