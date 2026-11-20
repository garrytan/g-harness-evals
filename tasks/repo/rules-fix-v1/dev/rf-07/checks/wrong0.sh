#!/bin/bash
# A plausible wrong fix: treats BEGIN TRANSACTION as a statement but still counts newlines before BEGIN as content.
cd /work/repo
git apply /checks/wrong0.patch
