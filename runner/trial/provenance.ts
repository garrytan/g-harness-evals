// Adapter provenance. A harness image built before an adapter edit silently runs the old adapter (the gbrain arm's
// smoke lost a run to it). preflight compares the sha256 of /opt/harness/adapter.sh inside the image with the checkout's
// harnesses/<name>/adapter.sh and refuses a mismatch (HE-ADAPTER-005); the adapters write the same sha into their ready
// file so every trial record can carry it. internal-task: Harness Zero's logic is in zero.ts and its config, not in adapter.sh, so
// for it preflight also compares zero.ts, pin.json, the Dockerfile and every file under config/ (features.json, candidates.json,
// the prompt files): the candidate hash covers all of them.
//
// internal-task (H10): a harness with harnesses/<name>/provenance.json (HarnessProvenanceManifest) is checked file by file: every
// checkout-owned file the manifest lists must be in the image at its image path with the checkout's sha256, or preflight
// refuses naming the missing or changed files (HE-ADAPTER-005). Installed runtimes (npm packages, a source checkout, a venv,
// a downloaded binary) are not listed and not compared; their pin.json versions cover them. One digest over the sorted
// listing (provenanceDigest) goes in the preflight receipt, the goldens log and each trial record (provenance_sha256). The
// image id is recorded as a receipt and never compared. A harness without a manifest keeps the adapter.sh-only check.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessProvenanceManifest } from '../contracts.ts';
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

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** harnesses/<name>/provenance.json, or null when the harness has none. */
export function readProvenanceManifest(harness: string, repoRoot = '.'): HarnessProvenanceManifest | null {
  const path = join(repoRoot, 'harnesses', harness, 'provenance.json');
  if (!existsSync(path)) return null;
  const m = JSON.parse(readFileSync(path, 'utf8')) as HarnessProvenanceManifest;
  if (m.harness !== harness || !Array.isArray(m.files) || !m.files.length || m.files.some((f) => typeof f?.checkout !== 'string' || typeof f?.image !== 'string' || !f.image.startsWith('/opt/harness/'))) {
    throw new RunnerError('HE-ADAPTER-005', `${path} is not a provenance manifest for ${harness} ({harness, files: [{checkout, image under /opt/harness/}]}); fix: correct the file`);
  }
  return m;
}

export interface ProvenanceFile { checkout: string; image: string; sha256: string }

/** One sha256 over the listing, one "<sha256>  <image path>\n" line per file, sorted by image path bytes. */
export function provenanceDigest(files: ReadonlyArray<Pick<ProvenanceFile, 'image' | 'sha256'>>): string {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.image), Buffer.from(b.image)));
  return sha256(sorted.map((f) => `${f.sha256}  ${f.image}\n`).join(''));
}

/** The checkout side of a manifest: each listed file's sha256 and the digest, or null without a manifest. A listed file
 *  missing from the checkout is HE-ADAPTER-005. Reads no image, so the runner can stamp every trial record with it. */
export function checkoutProvenance(harness: string, repoRoot = '.'): { files: ProvenanceFile[]; digest: string } | null {
  const m = readProvenanceManifest(harness, repoRoot);
  if (!m) return null;
  const missing = m.files.filter((f) => !existsSync(join(repoRoot, f.checkout))).map((f) => f.checkout);
  if (missing.length) throw new RunnerError('HE-ADAPTER-005', `harnesses/${harness}/provenance.json lists ${missing.join(', ')}, which the checkout does not have; fix: correct the manifest or restore the file`);
  const files = m.files.map((f) => ({ checkout: f.checkout, image: f.image, sha256: sha256(readFileSync(join(repoRoot, f.checkout))) }));
  return { files, digest: provenanceDigest(files) };
}

export interface HarnessProvenance {
  harness: string;
  image: string;
  /** A receipt only: two machines that build the same checkout get different ids, so it is never compared. */
  image_id: string;
  /** "manifest": every file of harnesses/<name>/provenance.json; "adapter": the adapter.sh-only check of a harness without one. */
  check: 'manifest' | 'adapter';
  files: ProvenanceFile[];
  digest: string;
}

/**
 * Compare a harness image with the checkout. With a manifest: every listed file in the image at its image path with the
 * checkout's sha256 (one docker run of sha256sum over all of them), refusing a missing or changed file with HE-ADAPTER-005.
 * Without one: adapterProvenance. Files the image holds beyond the list (the installed runtimes) are not read.
 */
export async function harnessProvenance(harness: string, image: string, repoRoot = '.'): Promise<HarnessProvenance> {
  const checkout = checkoutProvenance(harness, repoRoot);
  if (!checkout) {
    const a = await adapterProvenance(harness, image, repoRoot);
    const files = [{ checkout: join('harnesses', harness, 'adapter.sh'), image: '/opt/harness/adapter.sh', sha256: a.checkout_sha256 }];
    return { harness, image, image_id: a.image_id, check: 'adapter', files, digest: provenanceDigest(files) };
  }
  const fix = `fix: docker build -q -t ${image} harnesses/${harness} and run preflight again`;
  const inspect = await sh(['docker', 'image', 'inspect', '-f', '{{.Id}}', image]);
  if (inspect.status !== 0) throw new RunnerError('HE-ADAPTER-005', `harness image ${image} is not present for ${harness}; fix: docker build -q -t ${image} harnesses/${harness}`);
  const r = await sh(['docker', 'run', '--rm', '--entrypoint', 'sha256sum', image, ...checkout.files.map((f) => f.image)]);
  const inImage = new Map<string, string>();
  for (const line of r.stdout.split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (m) inImage.set(m[2]!, m[1]!);
  }
  if (r.status !== 0 && !inImage.size && !/No such file/.test(r.stderr)) throw new RunnerError('HE-ADAPTER-005', `cannot read the listed files in ${image}: ${(r.stderr || r.stdout).trim().slice(0, 300)}; ${fix}`);
  const missing = checkout.files.filter((f) => !inImage.has(f.image));
  const changed = checkout.files.filter((f) => inImage.has(f.image) && inImage.get(f.image) !== f.sha256);
  if (missing.length || changed.length) {
    const parts = [
      ...(missing.length ? [`missing from the image: ${missing.map((f) => f.image).join(', ')}`] : []),
      ...(changed.length ? [`changed: ${changed.map((f) => `${f.image} is ${inImage.get(f.image)!.slice(0, 12)} in the image and ${f.checkout} is ${f.sha256.slice(0, 12)}`).join('; ')}`] : []),
    ];
    throw new RunnerError('HE-ADAPTER-005', `harness image ${image} does not carry the checkout's files for ${harness} (harnesses/${harness}/provenance.json): ${parts.join('; ')}; ${fix}`);
  }
  return { harness, image, image_id: inspect.stdout.trim(), check: 'manifest', files: checkout.files, digest: checkout.digest };
}
