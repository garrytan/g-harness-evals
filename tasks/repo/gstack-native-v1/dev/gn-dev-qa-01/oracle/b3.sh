#!/usr/bin/env bash
set -euo pipefail
python3 <<'PY'
import json, os, urllib.request, urllib.error
base = os.environ['APP_URL'].rstrip('/')
def post(path, data):
    req = urllib.request.Request(base + path, data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)
status, created = post('/api/shifts', {'title': 'Email check', 'capacity': 2, 'hours': 1})
if status != 201:
    raise SystemExit('Could not create shift')
path = '/api/shifts/' + str(created['id']) + '/signups'
status, _ = post(path, {'name': 'First Volunteer', 'email': 'Volunteer@example.com'})
if status != 201:
    raise SystemExit('Could not create initial signup')
status, _ = post(path, {'name': 'Second Volunteer', 'email': 'volunteer@example.com'})
if status != 409:
    raise SystemExit('Expected 409 for case-insensitive duplicate, got ' + str(status))
PY
