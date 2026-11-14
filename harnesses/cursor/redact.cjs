// Copies stdin to stdout with every occurrence of one environment variable's value replaced by a fixed marker, so the
// Cursor CLI's stream-json and stderr reach the trial logs without the key, whatever the CLI or a command it runs
// prints (harnesses/cursor/README.md, "Keys"). The variable is named on the command line; its value is read from this
// process's environment and never printed, logged or passed as an argument. A value split across two reads is caught by
// holding back the last length-1 bytes of each chunk. With the variable unset or empty the bytes pass through unchanged.
'use strict';
const name = process.argv[2];
if (!name) { process.stderr.write('usage: node redact.cjs <ENV_NAME>\n'); process.exit(2); }
const value = process.env[name] ?? '';
const needle = Buffer.from(value);
const marker = Buffer.from('[redacted:' + name + ']');
let held = Buffer.alloc(0);
const replaceAll = (buf) => {
  const parts = [];
  let from = 0;
  for (let at = buf.indexOf(needle, from); at >= 0; at = buf.indexOf(needle, from)) { parts.push(buf.subarray(from, at), marker); from = at + needle.length; }
  parts.push(buf.subarray(from));
  return Buffer.concat(parts);
};
process.stdin.on('data', (chunk) => {
  if (!needle.length) { process.stdout.write(chunk); return; }
  const buf = replaceAll(Buffer.concat([held, chunk]));
  const keep = Math.min(needle.length - 1, buf.length);
  held = Buffer.from(buf.subarray(buf.length - keep));
  process.stdout.write(buf.subarray(0, buf.length - keep));
});
process.stdin.on('end', () => { process.stdout.write(needle.length ? replaceAll(held) : held); });
