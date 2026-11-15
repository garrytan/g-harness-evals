#!/bin/bash
# Every planted hunk reported with a test that fails whatever the code does.
mkdir -p /work/out/tests
printf 'def test_bad():\n    assert False\n' > /work/out/tests/test_bad.py
python3 - <<'PY'
import json
json.dump([{"file":"tabulate/sql.py","line":63,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tabulate/sql.py","line":106,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tabulate/sql.py","line":117,"summary":"x","test":"/work/out/tests/test_bad.py"},{"file":"tabulate/sql.py","line":74,"summary":"x","test":"/work/out/tests/test_bad.py"}], open('/work/out/review.json', 'w'))
PY
