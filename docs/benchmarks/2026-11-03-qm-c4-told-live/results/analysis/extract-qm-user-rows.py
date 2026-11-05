#!/usr/bin/env python3
"""Write each QM trial's stored UserMessage rows as logs/qm-user-messages.jsonl.

The C4 preregistration (Receipts) publishes the stored UserMessage rows of QM's items table per trial
(payload.environment, payload.memoryRecall). The raw pg_dump (logs/qm-db.sql.gz) also holds session leases and other
harness state, so it stays out of the repository and only these fields are kept.

    python3 analysis/extract-qm-user-rows.py <results dir>
"""
import gzip
import json
import os
import re
import sys

ESC = {'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t', 'v': '\v', '\\': '\\'}


def copy_text(value):
    if value == '\\N':
        return None
    return re.sub(r'\\(.)', lambda m: ESC.get(m.group(1), m.group(1)), value)


def user_rows(dump):
    cols, rows = None, []
    with gzip.open(dump, 'rt', encoding='utf-8') as f:
        for line in f:
            if cols is None:
                if line.startswith('COPY public.items '):
                    cols = [c.strip() for c in line[line.index('(') + 1:line.index(')')].split(',')]
                continue
            if line.startswith('\\.'):
                break
            row = dict(zip(cols, (copy_text(v) for v in line.rstrip('\n').split('\t'))))
            if row.get('kind') != 'UserMessage':
                continue
            body = json.loads(row['body']) if row.get('body') else {}
            rows.append({
                'session_id': row.get('session_id'),
                'seq': int(row['seq']),
                'turn_id': row.get('turn_id'),
                'created_at': row.get('created_at'),
                'environment': body.get('environment'),
                'memoryRecall': body.get('memoryRecall'),
            })
    return sorted(rows, key=lambda r: (r['created_at'] or '', r['seq']))


def main(results):
    written = 0
    for cell in sorted(os.listdir(os.path.join(results, 'trials'))):
        for task in sorted(os.listdir(os.path.join(results, 'trials', cell))):
            for rep in sorted(os.listdir(os.path.join(results, 'trials', cell, task))):
                logs = os.path.join(results, 'trials', cell, task, rep, 'logs')
                dump = os.path.join(logs, 'qm-db.sql.gz')
                if not os.path.exists(dump):
                    print(f'missing {dump}', file=sys.stderr)
                    continue
                with open(os.path.join(logs, 'qm-user-messages.jsonl'), 'w', encoding='utf-8') as out:
                    for row in user_rows(dump):
                        out.write(json.dumps(row, sort_keys=True) + '\n')
                written += 1
    print(f'wrote qm-user-messages.jsonl for {written} trials')


if __name__ == '__main__':
    main(sys.argv[1])
