# Getting started

Requires Python 3.11+.

```bash
pip install -e .
shipq enqueue send_email '{"to": "a@example.com"}'
```

To process jobs, start a worker from code that registers your handlers:

```python
from shipq import Queue, Worker

queue = Queue("jobs.db")

@queue.register("send_email")
def send_email(payload):
    print("sending to", payload["to"])

Worker(queue).run_forever()
```
