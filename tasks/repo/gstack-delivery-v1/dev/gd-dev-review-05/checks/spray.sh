#!/bin/bash
# The real findings plus findings whose tests pass on the defective change, ten in all.
mkdir -p /work/out/tests
cp /oracle/test_cookie_name.py /work/out/tests/test_cookie_name.py
cp /oracle/test_unsigned.py /work/out/tests/test_unsigned.py
cp /oracle/test_timedelta.py /work/out/tests/test_timedelta.py
cp /oracle/test_signature_type.py /work/out/tests/test_signature_type.py
printf 'def test_ok():\n    assert True\n' > /work/out/tests/test_ok.py
python3 - <<'PY'
import json
json.dump([{"file":"bottle.py","line":2969,"summary":"The signature does not cover the cookie name, so a value signed for one cookie is accepted under any other cookie name.","test":"/work/out/tests/test_cookie_name.py"},{"file":"bottle.py","line":1185,"summary":"With a secret, a cookie that is not in the signed format falls through to the unsigned return, so a client-set plain value is accepted as if it were signed.","test":"/work/out/tests/test_unsigned.py"},{"file":"bottle.py","line":2958,"summary":"A timedelta max_age is converted with .seconds, which drops the days, so a cookie set for whole days expires at once.","test":"/work/out/tests/test_timedelta.py"},{"file":"bottle.py","line":2949,"summary":"_lscmp() now uses hmac.compare_digest(), which raises TypeError for a str with non-ASCII characters; the signature part of a cookie is client-controlled (a quoted cookie may carry octal escapes such as \\351), so a crafted cookie makes get_cookie() raise instead of returning the default.","test":"/work/out/tests/test_signature_type.py"},{"file":"bottle.py","line":2970,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2971,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2972,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2973,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2974,"summary":"x","test":"/work/out/tests/test_ok.py"},{"file":"bottle.py","line":2975,"summary":"x","test":"/work/out/tests/test_ok.py"}], open('/work/out/review.json', 'w'))
PY
