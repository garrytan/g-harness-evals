#!/bin/bash
# A plausible wrong fix: treats an empty table as having no columns, so the header widths list does not match the headers.
cd /work/repo
git apply /checks/wrong0.patch
