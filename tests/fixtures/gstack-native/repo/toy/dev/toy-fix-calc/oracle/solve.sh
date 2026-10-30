#!/bin/bash
set -euo pipefail
cd /work/repo
sed -i 's/return a - b/return a + b/' calc.py
