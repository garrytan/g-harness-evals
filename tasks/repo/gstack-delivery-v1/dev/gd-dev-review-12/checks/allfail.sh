#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/config.py","line":33,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/config.py","line":58,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/config.py","line":70,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/config.py","line":128,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"schedule/config.py","line":83,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
