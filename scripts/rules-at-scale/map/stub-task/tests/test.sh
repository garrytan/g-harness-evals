#!/bin/sh
# The delivery map runs with the verifier off; this exists because Harbor's task format needs it.
mkdir -p /logs/verifier && echo 0 > /logs/verifier/reward.txt
