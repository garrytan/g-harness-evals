// Provenance: ASK_RE, INPUT_REQUEST_RE, closingBlock and asksForInput are ported from gbrain-evals eval/runner/cat41/scenarios.ts
// (commit 4f27313a, sha256 36fba23ab39dad9c7bd40452b82c6f1185574f7ee005ad6f61038f01242aba4b), and the shape of this file (deterministic
// rules over the transcript and the container probes, no model judge) from eval/runner/cat41/classify.ts (same commit, sha256
// 42232d5a5f490c391ea7600b59d56f0e83d9d1d886bea66ac670d9035cfba068), both MIT, same owner. recalledViaMcp is generalised to isGbrainCall
// in transcript.ts. The stalls, routes, install-doc, harness-memory, gbrain-code and infra rules are new (plan "Design": Ease).
//
// classifyInstall reads one install trial (its turns with their events and end-of-turn probes, the watcher lines and the egress log)
// and returns InstallClassification, the trials.jsonl install.classification field (scripts/gbrain-install/README.md).
import { createHash } from 'node:crypto';
import { stepOf, stepTimes, succeeded, turnStep } from './steps.ts';
import { gbrainArgvFromShell, githubRateLimited, isGbrainCall, norm, unwrapShell, type NEvent } from './transcript.ts';

export interface Probe { harness: string; at: string; binary: string | null; version: string | null; brain: boolean; brain_path: string | null; mcp: boolean; instructions: boolean; hook: boolean; wired: string[]; ok: boolean }
export interface InstallTurn { turn: number; session: 's1' | 's2' | 's3'; role: 'arm' | 'reply' | 'save' | 'recall' | 'hinted'; text: string; reply_text: string | null; exit: number; started_at: string; ended_at: string; probe: Probe | null; events: NEvent[] }
export interface EgressLine { at: string; trial: string | null; method: string; host: string; port: number; decision: 'allowed' | 'blocked' | 'failed'; status?: number }
export interface InstallClassification { route: string | null; install_attempts: Array<{ route: string; ref: string | null; ok: boolean }>; probe_versions: { first: string | null; last: string | null }; version: string | null; install_doc: Array<{ url: string; ref: string | null; sha256: string | null }>; stalls: Array<{ kind: 'blocked-step' | 'question'; step: string; label: string; turn: number }>; person_needed: Array<{ turn: number; step: string; kind: 'scripted-reply' | 'blocked-step' | 'question' }>; failed_commands: number; retried_commands: number; question_types: Record<string, number>; saved_to_harness_memory: boolean; last_gbrain_code: string | null; steps: { binary_ms: number | null; brain_ms: number | null; wired_ms: number | null; saved_ms: number | null; recalled_ms: number | null }; died_at_step: string | null; infra: string | null }

export const ASK_RE = /(\?\s*$|\b(waiting (on|for) your|your (choice|decision|answer|call)|which (one|option|mode)|would you like|do you want|shall i|should i|want me to|let me know|your (approval|permission|confirmation|go-ahead|ok)|approve|confirm|okay to proceed|ok to proceed|before i (run|proceed|spend|do)|please (run|provide|share|paste|grant|restart|stop|reconnect|mount|tell me|confirm)|you('ll| will)? need to|you can run|you'?d need to|ask (your|the) (admin|administrator|host|owner))\b)/im;

/**
 * The agent's turn closes by asking the user something. Only the closing block counts (the last blank-line-separated block, or the
 * whole trailing list when the turn ends in one), so a question earlier in a long summary does not: a sentence ending in "?" (outside
 * double quotes, code and URLs) or an explicit request for input ("Reply 'defaults'...", "tell me...", "do you want..."). A conditional
 * offer ("tell me if you want it") is not a request: nothing waits on it.
 */
export const INPUT_REQUEST_RE = /(\?(?=[*_)\]]*(\s|$))|(^|[.!?:]\s+|\*\*\s*|\n\s*|\bjust )(reply|respond)\b|(^|[.!?:,]\s+|\*\*\s*|\b(or|and|just|please) )tell me\b(?! if you)|\buntil you (choose|agree|decide|confirm|reply|say so)\b|\b((let me know|say the word)(?! if you)|(please|can you|could you) (confirm|choose|pick|decide|approve)|confirm (whether|if|which|that you)|your (call|choice|decision|answer|go-ahead|approval|permission)|do you want|would you (like|prefer)|should i|shall i|want me to|ok(ay)? to (proceed|continue|go ahead)|before i (proceed|continue|run|go ahead)|waiting (on|for) your)\b)/i;

export function closingBlock(text: string): string {
  const blocks = norm(text).replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, ' ').replace(/\x60[^\x60\n]*\x60/g, 'X').replace(/https?:\/\/\S+/g, 'URL').replace(/"[^"\n]*"/g, 'Q').trim().split(/\n\s*\n/);
  const isList = (b: string) => /^\s*([-*+]|\d+[.)])\s/.test(b);
  let i = blocks.length - 1;
  while (i > 0 && isList(blocks[i]) && (isList(blocks[i - 1]) || /:\s*$/.test(blocks[i - 1]))) i--;
  return blocks.slice(i).join('\n\n');
}

export function asksForInput(text: string): boolean {
  return INPUT_REQUEST_RE.test(closingBlock(text));
}

/** Stall (a), pinned: an error-shaped line in a tool output (tool) that the agent's text of the same turn echoes (echo). The first entry
 *  is the line from the first install we watched by hand (2026-11-15); each other entry says why it is on the list. Changing this list changes scores. */
export const BLOCKED_LINES: ReadonlyArray<{ id: string; why: string; tool: RegExp; echo: RegExp; label: string }> = [
  { id: 'bun-blocked-postinstall', why: "the first install we watched by hand, 2026-11-15: Bun skips a dependency's postinstall script unless the package is trusted, and the agent has to explain it", tool: /\bBlocked \d+ postinstall/i, echo: /\bblocked\b[^\n]{0,80}\bpostinstall|\bpostinstall\b[^\n]{0,80}\bblock|bun pm (untrusted|trust)|trustedDependencies/i, label: 'One install step was blocked by Bun' },
  { id: 'eacces', why: 'a global npm or bun install into a directory the user cannot write, the usual npm -g failure without sudo', tool: /\bEACCES\b/, echo: /\bEACCES\b|permission denied|permissions? (error|problem|issue)|not (allowed|permitted) to write/i, label: 'One install step was refused for file permissions (EACCES)' },
  { id: 'gbrain-not-on-path', why: 'gbrain installed into a bin directory the shell does not search (for example ~/.bun/bin), so the next step cannot run it', tool: /(command not found: gbrain\b|\bgbrain: command not found|\bgbrain: not found)/, echo: /\bPATH\b|command not found|not found on|isn'?t on your|is not on your/i, label: 'gbrain was installed but the shell could not find it' },
  { id: 'bun-missing', why: 'the GitHub route needs Bun, which a clean machine does not have', tool: /(command not found: bun\b|\bbun: command not found|\bbun: not found)/, echo: /\bbun\b[^\n]{0,60}(not installed|isn'?t installed|not found|missing|not available)|install(ing)? bun\b/i, label: 'Bun was not installed' },
];

/** Install routes read from shell commands, first match wins per command. bun-github is Bun installing from a GitHub source; npm is any
 *  npm, pnpm or yarn install, or Bun installing the bare package name from the npm registry. */
export const ROUTES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: 'hosted', re: /\bgbrainio\b|\bgbrain\.io\b|\bterminalwire\b/i },
  { id: 'codex-plugin', re: /\bcodex\s+(plugin|plugins|marketplace)\b/i },
  { id: 'clawhub', re: /\bclawhub\s+(install|add)\b|\bclawhub:\S*gbrain/i },
  { id: 'git-clone', re: /\bgit\s+clone\b[^;&|\n]*gbrain/i },
  { id: 'curl-script', re: /\b(curl|wget)\b[^\n]*gbrain[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i },
  { id: 'bun-github', re: /\bbunx?\s+(add|install|i)\b[^;&|\n]*?(github:|github\.com\/|(?<![\w@:\/.-])[\w.-]+\/gbrain\b)/i },
  { id: 'npm', re: /\b(npm\s+(i|install|add)|pnpm\s+(add|install|i)|yarn\s+(global\s+)?add|bun\s+(add|install|i))\b[^;&|\n]*(?<![\w\/:.-])(@[\w-]+\/)?gbrain(@[\w.^~-]+)?(?![\w\/.-])/i },
];

const CHECKOUT_RE = /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|switch)\s+(?:(?:--detach|--quiet|-d|-q)\s+)*["']?(\w[\w.\/-]*)/i;

/** The gbrain ref an install command names: the #ref of a GitHub source, git clone's --branch or -b, a git checkout or switch in the
 *  same command, or an npm version (gbrain@x); null when it names none (the default branch, npm's latest, or a hosted or plugin route). */
export function installRef(command: string): string | null {
  return command.match(/gbrain(?:\.git)?#([\w.\/-]+)/i)?.[1]
    ?? command.match(/\bgit\s+clone\b[^;&|\n]*?(?:--branch[= ]|-b\s+)["']?([\w.\/-]+)/i)?.[1]
    ?? command.match(/(?<![\w\/:.-])gbrain@([\w.^~-]+)/i)?.[1]
    ?? command.match(CHECKOUT_RE)?.[1]
    ?? null;
}

const BROWSER_RE = /\b(open|visit|go to|click)\b[^.\n]{0,60}\b(link|URL|page|browser)\b|\b(sign|log) ?in\b[^.\n]{0,60}\b(browser|URL|link|account)\b|\bin (your|a) browser\b|\b(oauth|device code)\b/i;
const PASTE_RE = /\bpaste\b|\b(send me|give me|share|provide|enter|copy)\b[^.\n]{0,60}\b(key|token|secret|credential|password|code|output)s?\b/i;
const DOC_URL_RE = /https?:\/\/[^\s'"<>()\[\]\x60]*INSTALL_FOR_AGENTS\.md/gi;
const MEMORY_FILE_RE = /(^|[\/\s"'=:])(CLAUDE|AGENTS|MEMORY|USER)\.md\b|\/memor(y|ies)\//i;
const MEMORY_TOOL_RE = /^(memory|memory_(add|write|save|store|update|create)|save_memory|add_memory|remember)$/i;
const WRITE_TOOL_RE = /^(write|edit|multiedit|write_file|create_file|patch|apply_patch|str_replace|str_replace_editor|file_change)$/i;
const SHELL_MEMORY_RE = /(>>?|\btee\b(\s+-a)?|\bsed\s+-i\b[^;&|\n]*)\s*["']?[^\s;&|]*(CLAUDE|AGENTS|MEMORY|USER)\.md\b/i;
const GITHUB_HOST_RE = /(^|\.)(github\.com|githubusercontent\.com)$/i;
const GBRAIN_CODE_RE = /"code"\s*:\s*"([A-Za-z][A-Za-z0-9_.:-]*)"/g;

/** The git ref in a GitHub or raw.githubusercontent URL path, or null. */
export function refOf(url: string): string | null {
  const m = url.match(/^https?:\/\/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/(?:refs\/(?:heads|tags)\/)?([^\/]+)\//i) ?? url.match(/^https?:\/\/github\.com\/[^\/]+\/[^\/]+\/(?:blob|raw|tree)\/(?:refs\/(?:heads|tags)\/)?([^\/]+)\//i);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The sha256 of the fetched body, when the tool output holds it: a sha256sum printed in the output, or the output of a curl or wget
 *  that wrote the body to stdout (normalised to end in one newline, since harnesses trim it). Null otherwise, WebFetch included. */
function bodySha(e: NEvent): string | null {
  if (e.kind !== 'shell' || !succeeded(e) || !e.output.trim()) return null;
  const cmd = unwrapShell(e.input);
  if (/\b(sha256sum|shasum)\b/.test(cmd)) return e.output.match(/\b[0-9a-f]{64}\b/)?.[0] ?? null;
  const toStdout = /\bcurl\b/.test(cmd) ? !/(\s-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b|>|\|)/.test(cmd) : /\bwget\b/.test(cmd) && /(-O\s*-|-qO-)/.test(cmd) && !/[>|]/.test(cmd);
  return toStdout ? createHash('sha256').update(e.output.replace(/\n*$/, '\n')).digest('hex') : null;
}

const agentText = (t: InstallTurn) => [t.reply_text ?? '', ...t.events.filter(e => e.kind === 'text').map(e => e.output)].join('\n');
const finalText = (t: InstallTurn) => t.reply_text ?? t.events.filter(e => e.kind === 'text').at(-1)?.output ?? '';

function memoryWrite(e: NEvent): boolean {
  if (e.kind === 'shell') return SHELL_MEMORY_RE.test(unwrapShell(e.input));
  if (isGbrainCall(e)) return false;
  const tool = e.kind === 'mcp' ? e.name.replace(/^.*?__/, '') : e.name;
  return MEMORY_TOOL_RE.test(tool) || (WRITE_TOOL_RE.test(tool) && MEMORY_FILE_RE.test(e.input));
}

export function classifyInstall(o: { harness: string; turns: InstallTurn[]; watch: Probe[]; egress: EgressLine[]; started_at: string; finish?: boolean }): InstallClassification {
  const turns = [...o.turns].sort((a, b) => a.turn - b.turn);
  const events = turns.flatMap(t => t.events);
  const tools = events.filter(e => e.kind !== 'text');
  const shells = events.filter(e => e.kind === 'shell');
  const stalls: InstallClassification['stalls'] = [];
  const person: InstallClassification['person_needed'] = [];
  const questionTypes: Record<string, number> = {};

  turns.forEach((t, i) => {
    const step = turnStep(t);
    if (t.role === 'reply') person.push({ turn: t.turn, step: turnStep(turns[i - 1] ?? { probe: null, role: 'arm' }), kind: 'scripted-reply' });
    const said = agentText(t);
    for (const b of BLOCKED_LINES) {
      if (!t.events.some(e => e.kind !== 'text' && b.tool.test(e.output)) || !b.echo.test(said)) continue;
      stalls.push({ kind: 'blocked-step', step, label: b.label, turn: t.turn });
      person.push({ turn: t.turn, step, kind: 'blocked-step' });
    }
    const closing = closingBlock(finalText(t));
    const finished = t.role === 'hinted' || (t.role === 'recall' && o.finish !== false);
    if (asksForInput(finalText(t)) && !finished) {
      stalls.push({ kind: 'question', step, label: `Stopped to ask a question at step ${step}`, turn: t.turn });
      person.push({ turn: t.turn, step, kind: 'question' });
    }
    const type = BROWSER_RE.test(closing) ? 'browser' : PASTE_RE.test(closing) ? 'paste' : ASK_RE.test(closing) || INPUT_REQUEST_RE.test(closing) ? 'question' : null;
    if (type) questionTypes[type] = (questionTypes[type] ?? 0) + 1;
  });

  const command = (e: NEvent) => unwrapShell(e.input).replace(/\s+/g, ' ').trim();
  const failedBefore = new Set<string>();
  let retried = 0;
  for (const e of shells) {
    const c = command(e);
    if (!c) continue;
    if (failedBefore.has(c)) retried++;
    if (!succeeded(e)) failedBefore.add(c);
  }

  const attempts = shells.flatMap((e, i) => {
    const c = unwrapShell(e.input);
    const r = ROUTES.find(x => x.re.test(c));
    if (!r) return [];
    let ref = installRef(c);
    if (ref === null && r.id === 'git-clone') {
      for (const s of shells.slice(i + 1)) {
        const later = unwrapShell(s.input);
        if (ROUTES.some(x => x.re.test(later))) break;
        const m = succeeded(s) ? later.match(CHECKOUT_RE)?.[1] : undefined;
        if (m) { ref = m; break; }
      }
    }
    return [{ route: r.id, ref, ok: succeeded(e) }];
  });

  const versionOut = shells.filter(e => succeeded(e) && gbrainArgvFromShell(e.input).some(a => ['--version', '-v', '-V', 'version'].includes(a[0] ?? ''))).map(e => e.output.match(/\bv?(\d+\.\d+\.\d+(?:\.\d+)?)\b/)?.[1]).filter((v): v is string => !!v);
  const version = [...turns].reverse().find(t => t.probe?.version)?.probe?.version ?? versionOut.at(-1) ?? null;

  const installDoc: InstallClassification['install_doc'] = [];
  for (const e of tools) {
    for (const url of new Set(e.input.match(DOC_URL_RE) ?? [])) {
      const doc = { url, ref: refOf(url), sha256: bodySha(e) };
      if (!installDoc.some(d => d.url === doc.url && d.sha256 === doc.sha256)) installDoc.push(doc);
    }
  }

  const save = turns.filter(t => t.role === 'save').flatMap(t => t.events);
  const savedToHarness = save.some(memoryWrite) && !save.some(e => isGbrainCall(e) && succeeded(e));

  let lastCode: string | null = null;
  for (const e of tools) {
    if (!isGbrainCall(e) && !/"fix"\s*:/.test(e.output)) continue;
    for (const m of e.output.matchAll(GBRAIN_CODE_RE)) lastCode = m[1];
  }

  const seen = [...o.watch, ...turns.flatMap(t => t.probe ? [t.probe] : [])].filter(p => p.version).sort((a, b) => a.at.localeCompare(b.at));
  const everOk = turns.some(t => t.probe?.ok) || o.watch.some(p => p.ok);
  const lastProbe = [...turns].reverse().find(t => t.probe)?.probe ?? o.watch.at(-1) ?? null;
  const rateLimited = githubRateLimited(events) || o.egress.some(l => GITHUB_HOST_RE.test(l.host) && (l.status === 403 || l.status === 429));

  return {
    route: attempts.find(a => a.ok)?.route ?? attempts.at(-1)?.route ?? null,
    install_attempts: attempts,
    probe_versions: { first: seen[0]?.version ?? null, last: seen.at(-1)?.version ?? null },
    version,
    install_doc: installDoc,
    stalls,
    person_needed: person,
    failed_commands: shells.filter(e => !succeeded(e)).length,
    retried_commands: retried,
    question_types: questionTypes,
    saved_to_harness_memory: savedToHarness,
    last_gbrain_code: lastCode,
    steps: stepTimes({ turns, watch: o.watch, started_at: o.started_at, finish: o.finish }),
    died_at_step: everOk ? null : stepOf(lastProbe),
    infra: rateLimited ? 'github-rate-limit' : null,
  };
}
