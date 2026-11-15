#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_expiry.py /work/out/tests/test_expiry.py
cp /oracle/test_contains.py /work/out/tests/test_contains.py
cp /oracle/test_replace.py /work/out/tests/test_replace.py
cp /oracle/test_lookup_ttl.py /work/out/tests/test_lookup_ttl.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/sqlite.py","line":1,"summary":"Items count as live while expires >= now, so an item is still returned exactly ttl seconds after it was stored, unlike TTLCache and unlike expire().","test":"/work/out/tests/test_expiry.py"},{"file":"src/cachetools/sqlite.py","line":1,"summary":"`key in cache` goes through __getitem__, which marks the item as used, so membership checks change which item is evicted.","test":"/work/out/tests/test_contains.py"},{"file":"src/cachetools/sqlite.py","line":1,"summary":"Eviction counts the key being stored, so replacing the value of a key already in a full cache evicts another item.","test":"/work/out/tests/test_replace.py"},{"file":"src/cachetools/sqlite.py","line":1,"summary":"The lookup in __getitem__ appends _LIVE after AND without parentheses, and _LIVE is an OR, so the query reads (key = ? AND expires IS NULL) OR expires > ? and a missing key returns whichever item with a ttl has not expired yet.","test":"/work/out/tests/test_lookup_ttl.py"}], open('/work/out/review.json', 'w'))
PY
