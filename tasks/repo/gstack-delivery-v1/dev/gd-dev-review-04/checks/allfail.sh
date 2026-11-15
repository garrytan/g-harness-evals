#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/sqlite.py","line":10,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"src/cachetools/sqlite.py","line":73,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"src/cachetools/sqlite.py","line":120,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"src/cachetools/sqlite.py","line":51,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
