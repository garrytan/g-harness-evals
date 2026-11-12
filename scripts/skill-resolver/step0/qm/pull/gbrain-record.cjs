#!/usr/bin/env node
// internal-task QM pull check, release mode (qm-pull-check.ts --gbrain): a recorder in front of the real gbrain, installed as
// /usr/local/bin/gbrain in the check's sandbox image, with the release binary at /usr/local/lib/gbrain/gbrain. It passes argv,
// stdin and the environment through unchanged, writes the binary's stdout and stderr back byte for byte, exits with its code,
// and appends the call to /tmp/gbrain-stub/calls.ndjson in the same shape gbrain-stub.cjs logs (argv, no_autorebuild_set,
// stdin, exit, stdout, stdout_sha256), so the check's call and result checks read the release's calls as they read the
// stand-in's. The counted arm images carry the binary itself, with no recorder (Dockerfile.arms).
const fs = require('fs'), crypto = require('crypto'), { spawnSync } = require('child_process');
const argv = process.argv.slice(2);
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
const r = spawnSync('/usr/local/lib/gbrain/gbrain', argv, { input: stdin, encoding: 'utf8', maxBuffer: 8 << 20 });
const stdout = r.stdout ?? '', code = r.status ?? 1;
try {
  fs.mkdirSync('/tmp/gbrain-stub', { recursive: true });
  fs.appendFileSync('/tmp/gbrain-stub/calls.ndjson', JSON.stringify({ argv, cwd: process.cwd(), no_autorebuild_set: Boolean(process.env.GBRAIN_SKILLS_NO_AUTOREBUILD), stdin, exit: code, stdout, stdout_sha256: crypto.createHash('sha256').update(stdout).digest('hex'), recorder: 'gbrain-record.cjs' }) + '\n');
} catch { /* the log is the check's, never the call's */ }
process.stdout.write(stdout);
process.stderr.write(r.stderr ?? '');
process.exit(code);
