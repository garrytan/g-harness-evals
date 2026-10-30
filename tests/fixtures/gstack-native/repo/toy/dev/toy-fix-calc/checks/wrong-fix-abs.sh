#!/bin/bash
cd /work/repo && sed -i 's/return a - b/return abs(a) + abs(b)/' calc.py
