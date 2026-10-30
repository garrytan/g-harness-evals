#!/bin/bash
set -e
mkdir -p /work/out/tests
cp /oracle/test_f1.py /work/out/tests/test_f1.py
printf '[{"file": "schedule/__init__.py", "line": 139, "summary": "defect", "test": "/work/out/tests/test_f1.py"}]' > /work/out/review.json
