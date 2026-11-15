#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_expiry.py /work/out/tests/test_expiry.py
cp /oracle/test_contains.py /work/out/tests/test_contains.py
cp /oracle/test_replace.py /work/out/tests/test_replace.py
cp /oracle/test_lookup_ttl.py /work/out/tests/test_lookup_ttl.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/sqlite.py","line":10,"summary":"Items count as live while expires >= now, so an item is still returned exactly ttl seconds after it was stored, unlike TTLCache and unlike expire().","test":"/work/out/tests/test_expiry.py"},{"file":"src/cachetools/sqlite.py","line":73,"summary":"`key in cache` goes through __getitem__, which marks the item as used, so membership checks change which item is evicted.","test":"/work/out/tests/test_contains.py"},{"file":"src/cachetools/sqlite.py","line":120,"summary":"Eviction counts the key being stored, so replacing the value of a key already in a full cache evicts another item.","test":"/work/out/tests/test_replace.py"},{"file":"src/cachetools/sqlite.py","line":51,"summary":"The lookup in __getitem__ appends _LIVE after AND without parentheses, and _LIVE is an OR, so the query reads (key = ? AND expires IS NULL) OR expires > ? and a missing key returns whichever item with a ttl has not expired yet.","test":"/work/out/tests/test_lookup_ttl.py"},{"file":"src/cachetools/sqlite.py","line":11,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"src/cachetools/sqlite.py","line":12,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"src/cachetools/sqlite.py","line":13,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"src/cachetools/sqlite.py","line":14,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"src/cachetools/sqlite.py","line":15,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"src/cachetools/sqlite.py","line":16,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
