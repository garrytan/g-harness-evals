#!/bin/bash
# The real tests, each reported away from its planted hunk.
mkdir -p /work/out/tests
cp /oracle/test_private.py /work/out/tests/test_private.py
cp /oracle/test_prefix.py /work/out/tests/test_prefix.py
cp /oracle/test_imported.py /work/out/tests/test_imported.py
cp /oracle/test_atomic.py /work/out/tests/test_atomic.py
cp /oracle/test_zero_interval.py /work/out/tests/test_zero_interval.py
python3 - <<'PY'
import json
json.dump([{"file":"schedule/config.py","line":1,"summary":"The function name pattern accepts a leading underscore, so a config line can schedule a module's private helpers.","test":"/work/out/tests/test_private.py"},{"file":"schedule/config.py","line":1,"summary":"A module is allowed when its name merely starts with an allowed name, so allowing \"tasks\" also allows \"tasks_admin\" or \"tasksx\".","test":"/work/out/tests/test_prefix.py"},{"file":"schedule/config.py","line":1,"summary":"Any callable attribute of an allowed module is accepted, including functions it imported (shutil.rmtree, os.system), not only functions defined there.","test":"/work/out/tests/test_imported.py"},{"file":"schedule/config.py","line":1,"summary":"Each job is added to the scheduler as soon as its line is read, so when a later line is invalid the jobs before it stay scheduled.","test":"/work/out/tests/test_atomic.py"},{"file":"schedule/config.py","line":1,"summary":"A zero interval is accepted, and schedule's Job._schedule_next_run then adds a zero period forever, so one config line such as 'every 0 seconds do ...' hangs load_jobs and the application.","test":"/work/out/tests/test_zero_interval.py"}], open('/work/out/review.json', 'w'))
PY
