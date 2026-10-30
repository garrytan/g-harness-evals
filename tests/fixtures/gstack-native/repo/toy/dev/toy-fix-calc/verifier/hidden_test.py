import json
import random
import subprocess
import sys

# Trusted driver: it never imports the agent's code. The agent's calc.add runs in a child process as an unprivileged
# user, on inputs chosen here at random, and only the values it prints are graded, so a calc.py that exits early,
# exits 0 or touches the verifier's files cannot pass.
CHILD = "import json, sys; sys.path.append('/work/repo'); import calc; print(json.dumps([calc.add(a, b) for a, b in json.load(sys.stdin)]))"
rng = random.SystemRandom()
cases = [[2, 3], [-1, 1], [-2, -3], [2.5, 0.5]]
cases += [[rng.randint(-10**6, 10**6), rng.randint(-10**6, 10**6)] for _ in range(20)]
cases += [[rng.randint(-4000, 4000) / 4, rng.randint(-4000, 4000) / 4] for _ in range(10)]
run = subprocess.run(["/usr/bin/setpriv", "--reuid=65534", "--regid=65534", "--clear-groups", sys.executable, "-I", "-c", CHILD],
                     input=json.dumps(cases), capture_output=True, text=True, timeout=60, cwd="/work/repo")
lines = run.stdout.strip().splitlines()
got = json.loads(lines[-1]) if lines else None
sys.exit(0 if got == [a + b for a, b in cases] else 1)
