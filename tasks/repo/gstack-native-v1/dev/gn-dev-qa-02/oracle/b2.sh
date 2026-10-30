#!/usr/bin/env bash
set -euo pipefail
python3 <<'PY'
import json, os, uuid, urllib.request, urllib.error
base = os.environ['APP_URL'].rstrip('/')
body = dict(class_id=2, name='Seat Check', email=uuid.uuid4().hex+'@example.com', seats=5)
request = urllib.request.Request(base+'/api/bookings', data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(request, timeout=10) as response:
        status, result = response.status, json.load(response)
except urllib.error.HTTPError as response:
    status, result = response.code, json.load(response)
assert status == 400 and result == {'error':'Seats must be an integer from 1 to 4'}, (status, result)
PY
