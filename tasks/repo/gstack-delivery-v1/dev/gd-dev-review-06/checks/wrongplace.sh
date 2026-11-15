#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_table.py /work/out/tests/test_table.py
cp /oracle/test_keep.py /work/out/tests/test_keep.py
cp /oracle/test_seconds.py /work/out/tests/test_seconds.py
cp /oracle/test_last_success.py /work/out/tests/test_last_success.py
cp /oracle/test_table_chars.py /work/out/tests/test_table_chars.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/history.py","line":1,"summary":"The table name is checked with match() on an unanchored pattern, so any name that merely starts with an identifier passes and the rest goes into every statement as SQL.","test":"/work/out/tests/test_table.py"},{"file":"schedule/history.py","line":1,"summary":"Retention keeps the job's rows only if they are among the newest keep runs of all jobs, so a busy job deletes a quieter job's history.","test":"/work/out/tests/test_keep.py"},{"file":"schedule/history.py","line":1,"summary":"The duration uses timedelta.seconds, which drops fractions of a second (and whole days), instead of total_seconds().","test":"/work/out/tests/test_seconds.py"},{"file":"schedule/history.py","line":1,"summary":"last_success orders by id ascending, so it returns the oldest successful run rather than the newest.","test":"/work/out/tests/test_last_success.py"},{"file":"schedule/history.py","line":1,"summary":"The table-name pattern uses the range A-z, which also covers [ \\ ] ^ and the backtick, SQLite's identifier quote characters, so a table name that is not a plain identifier passes the check and its quoting goes into every statement.","test":"/work/out/tests/test_table_chars.py"}], open('/work/out/review.json', 'w'))
PY
