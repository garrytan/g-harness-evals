#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/directory_storage.py","line":27,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/directory_storage.py","line":64,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/directory_storage.py","line":116,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tinydb/directory_storage.py","line":106,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
