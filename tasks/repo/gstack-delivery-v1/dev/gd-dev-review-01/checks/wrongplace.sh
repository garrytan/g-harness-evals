#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_name.py /work/out/tests/test_name.py
cp /oracle/test_cells.py /work/out/tests/test_cells.py
cp /oracle/test_count.py /work/out/tests/test_count.py
cp /oracle/test_markup.py /work/out/tests/test_markup.py
python3 - <<'PY'
import json
json.dump([{"file":"tabulate/export.py","line":1,"summary":"Names are checked with re.match, which only anchors the start, so a name like a/../../x passes and the page is written outside the directory.","test":"/work/out/tests/test_name.py"},{"file":"tabulate/export.py","line":1,"summary":"Tables are rendered with the unsafehtml format, so cell text is written as raw HTML and data can inject scripts into the pages.","test":"/work/out/tests/test_cells.py"},{"file":"tabulate/export.py","line":1,"summary":"The index counts rows with the default headers instead of the export's headers, so with headers='firstrow' the header row is counted as a data row.","test":"/work/out/tests/test_count.py"},{"file":"tabulate/export.py","line":1,"summary":"The name pattern only refuses path separators and a leading dot, so a name such as <img src=x onerror=alert(1)> passes the check and is written unescaped into the index page's link, which injects markup; names may only hold letters, digits, _, - and . and must start with a letter or a digit.","test":"/work/out/tests/test_markup.py"}], open('/work/out/review.json', 'w'))
PY
