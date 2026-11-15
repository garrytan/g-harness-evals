#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_prefix.py /work/out/tests/test_prefix.py
cp /oracle/test_rollback.py /work/out/tests/test_rollback.py
cp /oracle/test_order.py /work/out/tests/test_order.py
cp /oracle/test_readonly.py /work/out/tests/test_readonly.py
cp /oracle/test_empty_prefix.py /work/out/tests/test_empty_prefix.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/sqlite_storage.py","line":80,"summary":"The prefix goes into a LIKE pattern unescaped, so _ and % in it match other databases' tables, which are then read and dropped.","test":"/work/out/tests/test_prefix.py"},{"file":"tinydb/sqlite_storage.py","line":94,"summary":"A write that fails part way still commits, so tables already dropped or emptied stay that way.","test":"/work/out/tests/test_rollback.py"},{"file":"tinydb/sqlite_storage.py","line":69,"summary":"Documents are read back ordered by their id as text, so ids 10 and 11 come before 2 instead of insertion order.","test":"/work/out/tests/test_order.py"},{"file":"tinydb/sqlite_storage.py","line":53,"summary":"readonly=True opens the file with mode=rw, so a read-only storage can still change the file.","test":"/work/out/tests/test_readonly.py"},{"file":"tinydb/sqlite_storage.py","line":43,"summary":"An empty prefix is accepted, so the LIKE pattern becomes %, every table in the file counts as one of this database's tables, and the next write drops the tables of every other database sharing the file.","test":"/work/out/tests/test_empty_prefix.py"},{"file":"tinydb/sqlite_storage.py","line":81,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/sqlite_storage.py","line":82,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/sqlite_storage.py","line":83,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/sqlite_storage.py","line":84,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/sqlite_storage.py","line":85,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
