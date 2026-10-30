#!/usr/bin/env bash
set -euo pipefail
python3 <<'PY'
import json, os, uuid, urllib.request, urllib.parse
base = os.environ['APP_URL'].rstrip('/')
email = uuid.uuid4().hex+'@example.com'
with urllib.request.urlopen(base+'/api/classes', timeout=10) as response:
    classes = json.load(response)['classes']
item = next((c for c in classes if c['remaining'] >= 1), None)
assert item is not None, 'Use a fresh data directory: no seats remain'
request = urllib.request.Request(base+'/api/bookings', data=json.dumps(dict(class_id=item['id'], name='Lookup Check', email=email, seats=1)).encode(), headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request, timeout=10) as response:
    assert response.status == 201
    booking = json.load(response)
url = base+'/api/bookings?'+urllib.parse.urlencode({'email': email.upper()})
with urllib.request.urlopen(url, timeout=10) as response:
    assert response.status == 200
    results = json.load(response)['bookings']
assert results == [booking], results
PY
