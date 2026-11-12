import argparse
import json

from .queue import Queue
from .worker import Worker


def main() -> None:
    parser = argparse.ArgumentParser(prog="shipq")
    sub = parser.add_subparsers(dest="cmd", required=True)
    enq = sub.add_parser("enqueue")
    enq.add_argument("name")
    enq.add_argument("payload")
    enq.add_argument("--db", default="jobs.db")
    work = sub.add_parser("work")
    work.add_argument("--db", default="jobs.db")
    args = parser.parse_args()

    queue = Queue(args.db)
    if args.cmd == "enqueue":
        print(queue.enqueue(args.name, json.loads(args.payload)))
    else:
        Worker(queue).run_forever()
