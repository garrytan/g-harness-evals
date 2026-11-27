#!/usr/bin/env python3
# Runs one gbrain owner command under a pseudo-terminal and types the short code it asks for, the way the owner would at their
# own terminal (gbrain rules approve, and gbrain correct run by the owner). Used by the C2 standing-rules eval
# (runner/trial/c2-rules.ts, runner/trial/first-wow.ts). Prints what the terminal showed; exits with the command's exit code, or
# 124 when nothing finished within the deadline. usage: pty-answer.py <argv...>
import os, pty, re, select, signal, sys, time

DEADLINE_S = 120
argv = sys.argv[1:]
if not argv:
    sys.exit('usage: pty-answer.py <argv...>')
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
buf, typed, status = b'', False, None
deadline = time.time() + DEADLINE_S
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.5)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            chunk = b''
        if chunk:
            buf += chunk
            m = re.search(rb'Type ([0-9a-f]{8}) to approve', buf)
            if m and not typed:
                os.write(fd, m.group(1) + b'\r')
                typed = True
            continue
    done, st = os.waitpid(pid, os.WNOHANG)
    if done:
        status = st
        break
if status is None:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    sys.stdout.write(buf.decode('utf8', 'replace'))
    sys.exit(124)
try:
    while True:
        chunk = os.read(fd, 4096)
        if not chunk:
            break
        buf += chunk
except OSError:
    pass
sys.stdout.write(buf.decode('utf8', 'replace'))
sys.exit(os.waitstatus_to_exitcode(status))
