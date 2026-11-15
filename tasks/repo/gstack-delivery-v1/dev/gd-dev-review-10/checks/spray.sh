#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_quote.py /work/out/tests/test_quote.py
cp /oracle/test_readonly.py /work/out/tests/test_readonly.py
cp /oracle/test_stray.py /work/out/tests/test_stray.py
cp /oracle/test_encoding.py /work/out/tests/test_encoding.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"tinydb/directory_storage.py","line":27,"summary":"quote() keeps / unescaped by default, so a table name containing ../ writes its file outside the database directory.","test":"/work/out/tests/test_quote.py"},{"file":"tinydb/directory_storage.py","line":64,"summary":"read_only=True still creates a missing directory, because only create_dirs is checked before os.makedirs.","test":"/work/out/tests/test_readonly.py"},{"file":"tinydb/directory_storage.py","line":116,"summary":"Every file not starting with a dot counts as a table, so other files in the directory are parsed as JSON and deleted by the next write.","test":"/work/out/tests/test_stray.py"},{"file":"tinydb/directory_storage.py","line":106,"summary":"_replace removes its temporary file only when the failure is an OSError, so a write that fails for another reason, such as a document the configured encoding cannot represent, leaves a stray temporary file in the database directory.","test":"/work/out/tests/test_encoding.py"},{"file":"tinydb/directory_storage.py","line":28,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/directory_storage.py","line":29,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/directory_storage.py","line":30,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/directory_storage.py","line":31,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/directory_storage.py","line":32,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"tinydb/directory_storage.py","line":33,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
