#!/usr/bin/env bash
set -euo pipefail
python3 <<'PY'
import json, os, urllib.request, urllib.error
base = os.environ['APP_URL'].rstrip('/')
req = urllib.request.Request(base + '/api/shifts', data=json.dumps({'title': 'Boundary check', 'capacity': 13, 'hours': 2}).encode(), headers={'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req, timeout=10) as response:
        status = response.status
except urllib.error.HTTPError as error:
    status = error.code
if status != 422:
    raise SystemExit('Expected 422 for capacity 13, got ' + str(status))
PY
