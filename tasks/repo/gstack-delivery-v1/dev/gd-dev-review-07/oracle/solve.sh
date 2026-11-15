#!/bin/bash
set -e
mkdir -p /work/out/tests
cp /oracle/test_sortfield.py /work/out/tests/test_sortfield.py
cp /oracle/test_cap.py /work/out/tests/test_cap.py
cp /oracle/test_lte.py /work/out/tests/test_lte.py
cp /oracle/test_isnull.py /work/out/tests/test_isnull.py
cp /oracle/test_negative.py /work/out/tests/test_negative.py
python3 - <<'PY'
import json
json.dump([{"file":"playhouse/query_args.py","line":79,"summary":"sort looks names up among all of the model's fields instead of the allowed ones, so a client can sort on a field the view did not list, such as a password hash, and learn its values from the order.","test":"/work/out/tests/test_sortfield.py"},{"file":"playhouse/query_args.py","line":87,"summary":"max_per_page only caps the default page size, so a client-supplied per_page is used as given and can fetch any number of rows.","test":"/work/out/tests/test_cap.py"},{"file":"playhouse/query_args.py","line":40,"summary":"The lte operator maps to operator.lt, so __lte excludes rows equal to the value.","test":"/work/out/tests/test_lte.py"},{"file":"playhouse/query_args.py","line":100,"summary":"isnull passes the string to is_null, and the string 'false' is truthy, so __isnull=false selects the rows that are null.","test":"/work/out/tests/test_isnull.py"},{"file":"playhouse/query_args.py","line":111,"summary":"_positive only rejects 0, so a negative per_page gets through. min() keeps it below max_per_page and SQLite treats LIMIT -1 as no limit, so a client can fetch every row.","test":"/work/out/tests/test_negative.py"}], open('/work/out/review.json', 'w'))
PY
