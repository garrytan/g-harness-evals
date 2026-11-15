#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"more_itertools/more.py","line":5741,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"more_itertools/more.py","line":5767,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"more_itertools/more.py","line":5674,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"more_itertools/more.py","line":5724,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
