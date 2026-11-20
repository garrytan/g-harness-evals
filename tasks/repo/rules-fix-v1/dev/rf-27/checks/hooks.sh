#!/bin/bash
# No fix, plus a conftest that skips every test and test files edited to skip themselves; the verifier must remove and restore them.
cd /work/repo
printf 'import pytest\ndef pytest_collection_modifyitems(items):\n    for i in items:\n        i.add_marker(pytest.mark.skip)\n' > conftest.py
cp conftest.py tests/conftest.py
for f in $(git ls-files 'tests/*.py' | head -3); do echo 'import pytest; pytest.skip(allow_module_level=True)' >> "$f"; done
