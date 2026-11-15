#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_errors.py /work/out/tests/test_errors.py
cp /oracle/test_join_hit.py /work/out/tests/test_join_hit.py
cp /oracle/test_instances.py /work/out/tests/test_instances.py
cp /oracle/test_stacked.py /work/out/tests/test_stacked.py
cp /oracle/test_clear_running.py /work/out/tests/test_clear_running.py
python3 - <<'PY'
import json
json.dump([{"file":"src/cachetools/aio.py","line":1,"summary":"The call in progress is forgotten only when it succeeds, so after a call raises every later call with that key awaits the same failed task and gets the old exception forever.","test":"/work/out/tests/test_errors.py"},{"file":"src/cachetools/aio.py","line":1,"summary":"A call that joins a call in progress is counted as a miss, not a hit, so cache_info() reports one miss per caller.","test":"/work/out/tests/test_join_hit.py"},{"file":"src/cachetools/aio.py","line":1,"summary":"Calls in progress are grouped by the id of the cache accessor, which every instance shares, and methodkey leaves out self, so a concurrent call on one instance gets another instance's result (one user's data served to another).","test":"/work/out/tests/test_instances.py"},{"file":"src/cachetools/aio.py","line":1,"summary":"update_wrapper runs after the cache attributes are set, so it copies the wrapped function's __dict__ over them and a stacked decorator reports the inner decorator's cache, cache_key and cache_clear.","test":"/work/out/tests/test_stacked.py"},{"file":"src/cachetools/aio.py","line":1,"summary":"cache_clear() also empties the table of calls in progress, so a call that is running when the cache is cleared fails with KeyError (when _run deletes its entry) for every caller waiting on it.","test":"/work/out/tests/test_clear_running.py"}], open('/work/out/review.json', 'w'))
PY
