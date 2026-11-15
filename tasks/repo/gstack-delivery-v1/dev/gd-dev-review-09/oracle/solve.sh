#!/bin/bash
set -e
mkdir -p /work/out/tests
cp /oracle/test_partial.py /work/out/tests/test_partial.py
cp /oracle/test_clear.py /work/out/tests/test_clear.py
cp /oracle/test_keyword.py /work/out/tests/test_keyword.py
cp /oracle/test_empty_run.py /work/out/tests/test_empty_run.py
python3 - <<'PY'
import json
json.dump([{"file":"more_itertools/more.py","line":5741,"summary":"The run is recorded in a finally block, so a run that raises or is closed early is stored as if it were complete and later calls replay the partial result.","test":"/work/out/tests/test_partial.py"},{"file":"more_itertools/more.py","line":5767,"summary":"cache_clear() resets the generation to 0 instead of advancing it, so a run that was under way when the cache was cleared still records its result.","test":"/work/out/tests/test_clear.py"},{"file":"more_itertools/more.py","line":5674,"summary":"Keyword arguments are appended to the key without a marker, so f(1, ('b', 2)) and f(1, b=2) share a recording.","test":"/work/out/tests/test_keyword.py"},{"file":"more_itertools/more.py","line":5724,"summary":"replay() treats an empty recording as no recording, but record() stores a run that produced nothing as an empty list, so a function whose run yields no items is called again on every call instead of being replayed.","test":"/work/out/tests/test_empty_run.py"}], open('/work/out/review.json', 'w'))
PY
