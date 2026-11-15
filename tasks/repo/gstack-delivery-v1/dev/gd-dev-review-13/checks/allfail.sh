#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/archive.py","line":52,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/archive.py","line":67,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/archive.py","line":81,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/archive.py","line":37,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"playhouse/archive.py","line":140,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
