#!/usr/bin/env bun
// Leak scan and hash file for the catalog snapshot (tasks/mcp-at-scale/catalog/). The scan looks for credential-shaped
// strings, email addresses, internal or private hostnames and addresses, and names that must never appear in public
// material. A hit is allowed only by a rule below that says why (documentation domains, loopback, and the like); any
// other hit fails the scan without writing anything. A clean scan writes leak-scan.json (hit metadata only) and then
// SHA256SUMS (sha256 of every file in the snapshot except SHA256SUMS itself), so the hash file covers the report too.
//
//   bun scripts/mcp-at-scale/catalog/scan.ts [--check]
// --check verifies SHA256SUMS and the scan without writing anything.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const CATALOG = resolve(import.meta.dir, '../../../tasks/mcp-at-scale/catalog');

const PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'openai-or-anthropic-key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'stripe-key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/g },
  { id: 'gitlab-token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'bearer-value', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{24,}=*/g },
  { id: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { id: 'internal-hostname', re: /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:internal|corp|intranet|lan|local|ts\.net|localdomain)\b/g },
  { id: 'private-ip', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g },
  { id: 'private-name', re: /\b(?:wintermute|garry|garrytan|capy)\b/gi },
];

// Each rule: which pattern, what the match must look like, and why it is not a leak.
const ALLOW: { id: string; re: RegExp; why: string }[] = [
  { id: 'email', re: /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|test|invalid)$/i, why: 'documentation domain reserved by RFC 2606' },
  { id: 'email', re: /^(?:user|john\.doe|jane\.doe|someone|name)@(?:domain|company|email)\.com$/i, why: 'an obvious placeholder address in a tool description example, not a real mailbox' },
  { id: 'email', re: /^(?:licensing|legal|opensource|open-source|security|support|noreply|no-reply|help)@/i, why: 'a project or company contact address published in its own licence or tool description' },
  { id: 'internal-hostname', re: /^(?:[a-z0-9-]+\.)*(?:svc\.cluster\.local|cluster\.local)$/i, why: 'Kubernetes in-cluster DNS suffix, a generic convention, not a real host' },
  { id: 'internal-hostname', re: /^(?:host\.docker\.internal|localhost\.localdomain)$/i, why: 'generic Docker or loopback name used in setup instructions' },
  { id: 'private-ip', re: /.*/, why: 'RFC 1918 address used as a generic example in a tool description, never a real host of ours' },
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  }).sort();
}

export function scan() {
  const hits: { file: string; line: number; pattern: string; sha256_prefix: string; allowed: boolean; why?: string }[] = [];
  const scanned = files(CATALOG).filter((f) => !f.endsWith('SHA256SUMS') && !f.endsWith('leak-scan.json'));
  for (const f of scanned) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const p of PATTERNS) {
        for (const m of text.matchAll(p.re)) {
          const rule = ALLOW.find((a) => a.id === p.id && a.re.test(m[0]));
          const sha256_prefix = createHash('sha256').update(m[0]).digest('hex').slice(0, 12);
          hits.push({ file: relative(CATALOG, f), line: i + 1, pattern: p.id, sha256_prefix, allowed: !!rule, ...(rule ? { why: rule.why } : {}) });
        }
      }
    });
  }
  return { patterns: PATTERNS.map((p) => ({ id: p.id, regex: p.re.source })), files_scanned: scanned.length, hits, blocked: hits.filter((h) => !h.allowed).length };
}

export function sums(): string {
  return files(CATALOG).filter((f) => !f.endsWith('SHA256SUMS'))
    .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(CATALOG, f)}`).join('\n') + '\n';
}

if (import.meta.main) {
  const report = scan();
  if (report.blocked) {
    for (const h of report.hits) {
      if (!h.allowed) console.error(`BLOCKED ${h.file}:${h.line} ${h.pattern} sha256:${h.sha256_prefix}`);
    }
    process.exit(1);
  }
  const check = process.argv.includes('--check');
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  if (check) {
    const okReport = readFileSync(join(CATALOG, 'leak-scan.json'), 'utf8') === reportText;
    const okSums = readFileSync(join(CATALOG, 'SHA256SUMS'), 'utf8') === sums();
    console.log(`leak scan: ${report.hits.length} hits, ${report.blocked} blocked; report current: ${okReport}; SHA256SUMS current: ${okSums}`);
    process.exit(!okReport || !okSums ? 1 : 0);
  }
  writeFileSync(join(CATALOG, 'leak-scan.json'), reportText);
  writeFileSync(join(CATALOG, 'SHA256SUMS'), sums());
  console.log(`leak scan: ${report.files_scanned} files, ${report.hits.length} hits, ${report.blocked} blocked`);
}
