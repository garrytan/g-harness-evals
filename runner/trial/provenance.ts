// Adapter provenance. A harness image built before an adapter edit silently runs the old adapter (the gbrain arm's
// smoke lost a run to it). preflight compares the sha256 of /opt/harness/adapter.sh inside the image with the checkout's
// harnesses/<name>/adapter.sh and refuses a mismatch (HE-ADAPTER-005); the adapters write the same sha into their ready
// file so every trial record can carry it. internal-task: Harness Zero's logic is in zero.ts and its config, not in adapter.sh, so
// for it preflight also compares zero.ts, pin.json, the Dockerfile and every file under config/ (features.json, candidates.json,
// the prompt files): the candidate hash covers all of them.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunnerError } from '../errors.ts';

async function sh(args: string[], timeoutMs = 120_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { status, stdout, stderr };
  } finally { clearTimeout(timer); }
}

export interface AdapterProvenance { harness: string; image: string; image_id: string; image_sha256: string; checkout_sha256: string; files?: Record<string, string> }

/** The files besides adapter.sh that a harness runs from /opt/harness and that must match the checkout, relative to
 *  harnesses/<name>: for harness-zero, zero.ts, pin.json, the Dockerfile and every file under config/; none for the other harnesses. */
export function provenanceFiles(harness: string, repoRoot = '.'): string[] {
  if (harness !== 'harness-zero') return [];
  const dir = join(repoRoot, 'harnesses', harness);
  const walk = (rel: string): string[] => readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(rel + '/' + e.name) : [rel + '/' + e.name]);
  return ['zero.ts', 'pin.json', 'Dockerfile', ...walk('config').sort()];
}

/** The image's adapter.sh and the checkout's agree (HE-ADAPTER-005 otherwise, naming both digests and the rebuild command). */
export async function adapterProvenance(harness: string, image: string, repoRoot = '.'): Promise<AdapterProvenance> {
  const checkoutPath = join(repoRoot, 'harnesses', harness, 'adapter.sh');
  const checkout = createHash('sha256').update(readFileSync(checkoutPath)).digest('hex');
  const inspect = await sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', image]);
  if (inspect.status !== 0) throw new RunnerError('HE-ADAPTER-005', `harness image ${image} is not present for ${harness}; fix: docker build -q -t ${image} harnesses/${harness}`);
  const r = await sh(['docker', 'run', '--rm', '--entrypoint', 'sha256sum', image, '/opt/harness/adapter.sh']);
  if (r.status !== 0) throw new RunnerError('HE-ADAPTER-005', `cannot read /opt/harness/adapter.sh in ${image}: ${(r.stderr || r.stdout).trim().slice(0, 300)}; fix: docker build -q -t ${image} harnesses/${harness}`);
  const inImage = r.stdout.trim().split(/\s+/)[0] ?? '';
  if (inImage !== checkout) throw new RunnerError('HE-ADAPTER-005', `harness image ${image} carries adapter.sh ${inImage.slice(0, 12)} but ${checkoutPath} is ${checkout.slice(0, 12)}: the image was built from another adapter; fix: docker build -q -t ${image} harnesses/${harness} and run preflight again`);
  const extra = provenanceFiles(harness, repoRoot);
  if (!extra.length) return { harness, image, image_id: inspect.stdout.trim(), image_sha256: inImage, checkout_sha256: checkout };
  const listed = await sh(['docker', 'run', '--rm', '--entrypoint', 'bash', image, '-c', 'cd /opt/harness && sha256sum zero.ts pin.json Dockerfile $(find config -type f | sort)']);
  if (listed.status !== 0) throw new RunnerError('HE-ADAPTER-005', `cannot read zero.ts, pin.json, Dockerfile and config/ in ${image}: ${(listed.stderr || listed.stdout).trim().slice(0, 300)}; fix: docker build -q -t ${image} harnesses/${harness}`);
  const inImageFiles = new Map(listed.stdout.trim().split('\n').map((l) => { const [h, f] = l.trim().split(/\s+/); return [f ?? '', h ?? ''] as const; }));
  const files: Record<string, string> = {};
  for (const f of [...new Set([...extra, ...inImageFiles.keys()])].sort()) {
    const want = extra.includes(f) ? createHash('sha256').update(readFileSync(join(repoRoot, 'harnesses', harness, f))).digest('hex') : 'absent';
    const got = inImageFiles.get(f) ?? 'absent';
    if (got !== want) throw new RunnerError('HE-ADAPTER-005', `harness image ${image} carries ${f} ${got.slice(0, 12)} but harnesses/${harness}/${f} is ${want.slice(0, 12)}: the image was built from another checkout; fix: docker build -q -t ${image} harnesses/${harness} and run preflight again`);
    files[f] = want;
  }
  return { harness, image, image_id: inspect.stdout.trim(), image_sha256: inImage, checkout_sha256: checkout, files };
}
