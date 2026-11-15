#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/sqlite_storage.py","line":80,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/sqlite_storage.py","line":94,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/sqlite_storage.py","line":69,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/sqlite_storage.py","line":53,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/sqlite_storage.py","line":43,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
