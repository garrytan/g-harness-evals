#!/bin/bash
# A plausible wrong fix: stops escaping inline code in the parser but does not escape it in the HTML renderer.
cd /work/repo
git apply /checks/wrong0.patch
