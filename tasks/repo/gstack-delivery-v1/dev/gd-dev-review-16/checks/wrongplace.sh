#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_limit.py /work/out/tests/test_limit.py
cp /oracle/test_types.py /work/out/tests/test_types.py
cp /oracle/test_single.py /work/out/tests/test_single.py
cp /oracle/test_pairs.py /work/out/tests/test_pairs.py
cp /oracle/test_limit_type.py /work/out/tests/test_limit_type.py
python3 - <<'PY'
import json
json.dump([{"file":"more_itertools/more.py","line":1,"summary":"The limit is compared with the size of one part instead of the running total, so a user can name any amount of numbers by splitting them over several parts.","test":"/work/out/tests/test_limit.py"},{"file":"more_itertools/more.py","line":1,"summary":"Values are converted with int(), so strings and floats are silently accepted (and floats truncated) instead of raising TypeError.","test":"/work/out/tests/test_types.py"},{"file":"more_itertools/more.py","line":1,"summary":"A range whose end equals its start, such as 3-3, is rejected as ending before it starts.","test":"/work/out/tests/test_single.py"},{"file":"more_itertools/more.py","line":1,"summary":"Runs of two consecutive integers are written as start-end, although only runs of three or more should be.","test":"/work/out/tests/test_pairs.py"},{"file":"more_itertools/more.py","line":1,"summary":"The limit is converted with int() instead of operator.index like format_ranges' values, so a float limit is silently truncated and a string limit such as '10' is accepted instead of raising TypeError.","test":"/work/out/tests/test_limit_type.py"}], open('/work/out/review.json', 'w'))
PY
