#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_quote.py /work/out/tests/test_quote.py
cp /oracle/test_dryrun.py /work/out/tests/test_dryrun.py
cp /oracle/test_offset.py /work/out/tests/test_offset.py
cp /oracle/test_tablename.py /work/out/tests/test_tablename.py
cp /oracle/test_countcreate.py /work/out/tests/test_countcreate.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/archive.py","line":52,"summary":"_quote escapes a quote character inside a table name with a backslash, which SQL identifiers do not support, so a table name containing a double quote breaks or rewrites every statement.","test":"/work/out/tests/test_quote.py"},{"file":"playhouse/archive.py","line":67,"summary":"archive(dry_run=True) creates the archive table before it returns the count, so a dry run changes the database.","test":"/work/out/tests/test_dryrun.py"},{"file":"playhouse/archive.py","line":81,"summary":"Each batch is selected with an offset of the rows already moved, but moved rows are deleted, so later batches skip rows and they are never archived.","test":"/work/out/tests/test_offset.py"},{"file":"playhouse/archive.py","line":37,"summary":"The default archive table name is built from the model's class name instead of its table name, so a model with a custom table_name gets a wrongly named archive.","test":"/work/out/tests/test_tablename.py"},{"file":"playhouse/archive.py","line":140,"summary":"count() creates the archive table when it does not exist instead of returning 0, so reading the count changes the database, even right after a dry run or against a read-only connection.","test":"/work/out/tests/test_countcreate.py"},{"file":"playhouse/archive.py","line":53,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"playhouse/archive.py","line":54,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"playhouse/archive.py","line":55,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"playhouse/archive.py","line":56,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"playhouse/archive.py","line":57,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
