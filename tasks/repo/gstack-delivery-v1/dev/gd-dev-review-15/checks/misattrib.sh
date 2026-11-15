#!/bin/bash
# Each real test reported at another planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_drop.py /work/out/tests/test_drop.py
cp /oracle/test_short.py /work/out/tests/test_short.py
cp /oracle/test_write.py /work/out/tests/test_write.py
cp /oracle/test_existing.py /work/out/tests/test_existing.py
python3 - <<'PY'
import json
json.dump([{"file":"tabulate/sql.py","line":106,"summary":"The DROP TABLE statement for replace=True puts the table name into the SQL unquoted, so a name with a space or SQL in it breaks or rewrites the statement.","test":"/work/out/tests/test_drop.py"},{"file":"tabulate/sql.py","line":117,"summary":"Short rows are not padded with None, so the column types and the CREATE TABLE lose columns and the INSERT does not match them.","test":"/work/out/tests/test_short.py"},{"file":"tabulate/sql.py","line":74,"summary":"write_sql opens (and truncates) the file before to_sql runs, so a conversion error destroys the existing file.","test":"/work/out/tests/test_write.py"},{"file":"tabulate/sql.py","line":63,"summary":"The table is created with CREATE TABLE IF NOT EXISTS, so with replace=False the script no longer fails on an existing table of the same name and silently inserts the rows into it.","test":"/work/out/tests/test_existing.py"}], open('/work/out/review.json', 'w'))
PY
