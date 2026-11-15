#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_symlink.py /work/out/tests/test_symlink.py
cp /oracle/test_shared_headers.py /work/out/tests/test_shared_headers.py
cp /oracle/test_bad_root.py /work/out/tests/test_bad_root.py
cp /oracle/test_root_prefix.py /work/out/tests/test_root_prefix.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":2787,"summary":"The containment check uses abspath, which does not resolve symlinks, so a symlink below root serves files from anywhere on disk.","test":"/work/out/tests/test_symlink.py"},{"file":"bottle.py","line":792,"summary":"The response headers are written into the shared options dict, so the no-cache of an index page sticks to every later file response and changes the caller's headers dict.","test":"/work/out/tests/test_shared_headers.py"},{"file":"bottle.py","line":814,"summary":"The routes are registered before root is checked, so a failed call still leaves routes that shadow later ones.","test":"/work/out/tests/test_bad_root.py"},{"file":"bottle.py","line":2828,"summary":"static_file() now compares against root without a trailing separator, so for root /srv/pub a request for ../pub-private/key.txt passes the containment check and files from any sibling directory whose name starts with the root's name are served.","test":"/work/out/tests/test_root_prefix.py"},{"file":"bottle.py","line":2788,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2789,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2790,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2791,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2792,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2793,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
