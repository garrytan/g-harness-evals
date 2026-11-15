#!/bin/bash
set -e
mkdir -p /work/out/tests
cp /oracle/test_glob.py /work/out/tests/test_glob.py
cp /oracle/test_transaction.py /work/out/tests/test_transaction.py
cp /oracle/test_swapped.py /work/out/tests/test_swapped.py
cp /oracle/test_path_quote.py /work/out/tests/test_path_quote.py
python3 - <<'PY'
import json
json.dump([{"file":"jmespath/sqlite.py","line":88,"summary":"The GLOB pattern for starts_with and ends_with does not escape '[', so a literal bracket starts a character class and matches the wrong rows.","test":"/work/out/tests/test_glob.py"},{"file":"jmespath/sqlite.py","line":52,"summary":"select wraps its query in 'with conn:', which commits whatever the caller had pending on the connection.","test":"/work/out/tests/test_transaction.py"},{"file":"jmespath/sqlite.py","line":33,"summary":"Swapping the sides of an ordering negates it instead of mirroring it, so `5` < n compiles to n >= 5.","test":"/work/out/tests/test_swapped.py"},{"file":"jmespath/sqlite.py","line":123,"summary":"The double-quote check only looks at a plain field, so a key with a double quote inside a dotted path goes into the JSON path unescaped and reads another field (team.\"a\\\".\\\"b\" reads team.a.b).","test":"/work/out/tests/test_path_quote.py"}], open('/work/out/review.json', 'w'))
PY
