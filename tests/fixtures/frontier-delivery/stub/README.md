A stand-in for the few Harbor 0.24.0 names scripts/frontier-harbor/agents.py imports, and for PyYAML, so
tests/frontier-delivery.test.ts can drive the agent classes' delivery wiring without Harbor installed. Each class runs one
setup command and one launch command shaped like Harbor's own (the substring agents.py matches as LAUNCH).
