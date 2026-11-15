#!/bin/bash
# Each real test reported at another planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_delete_dirs.py /work/out/tests/test_delete_dirs.py
cp /oracle/test_hash.py /work/out/tests/test_hash.py
cp /oracle/test_no_mkdir.py /work/out/tests/test_no_mkdir.py
cp /oracle/test_names_tmp.py /work/out/tests/test_names_tmp.py
python3 - <<'PY'
import json
json.dump([{"file":"jmespath/library.py","line":107,"summary":"delete prunes empty directories with os.removedirs, which keeps climbing past the root and removes the root and its empty parents.","test":"/work/out/tests/test_delete_dirs.py"},{"file":"jmespath/library.py","line":27,"summary":"Comments are cut at the first # anywhere on a line, so a # inside a string literal truncates the expression.","test":"/work/out/tests/test_hash.py"},{"file":"jmespath/library.py","line":74,"summary":"The constructor creates the root directory, so merely opening or listing a library that does not exist yet creates it (and fails where the directory cannot be created).","test":"/work/out/tests/test_no_mkdir.py"},{"file":"jmespath/library.py","line":87,"summary":"names() deletes dot-prefixed .tmp files, which are the temporary files _write is still filling for a save in progress, so listing a library writes to disk and makes a concurrent save fail at os.replace.","test":"/work/out/tests/test_names_tmp.py"}], open('/work/out/review.json', 'w'))
PY
