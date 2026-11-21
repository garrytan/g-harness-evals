// The filler filter of the rules-at-scale eval: which lines and sections of a real rules file may sit beside the six planted
// rules. A unit (a section under a matching heading, a fenced code block, a list item with its indented lines, a table row or
// a paragraph) is dropped whole when any of its lines touches a planted rule's topic, a network or install step, or carries
// text that is unsafe to plant: an at sign (Claude Code and Gemini CLI expand @path text as an import), a link, an email
// address, a key-shaped string, a mention of a rules file by name, or an HTML comment (Claude Code strips HTML comments from
// CLAUDE.md before sending it, so they would make the delivered filler differ by harness), or a line that is mostly not
// English (notEnglish). Every drop is recorded with the reasons that matched.

export type Reason = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'network' | 'blocks_one_turn' | 'missing_tool' | 'at_sign' | 'link' | 'email' | 'key' | 'rules_file' | 'html_comment' | 'not_english' | 'heading_clash';
export const REASONS: readonly Reason[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'network', 'blocks_one_turn', 'missing_tool', 'at_sign', 'link', 'email', 'key', 'rules_file', 'html_comment', 'not_english', 'heading_clash'];

/** Topic patterns per planted rule, installs and the network; blocks_one_turn (asking, confirming with or waiting for a person,
 *  which a one-turn, non-interactive run cannot do); missing_tool (a tracker, service, server or project command the task image
 *  does not have). Case-insensitive; over-dropping is safe, a leak is not. */
export const TOPICS: Record<Exclude<Reason, 'at_sign' | 'link' | 'email' | 'key' | 'rules_file' | 'html_comment' | 'not_english' | 'heading_clash'>, RegExp[]> = {
  R1: [/\bchange ?logs?\b/i, /\bchanges?\s*\//i, /\bchanges? files?\b/i, /\bnews ?fragments?\b/i, /\bfragments?\b/i, /\brelease[- ]notes?\b/i, /\bnew files?\b/i, /\bfile ?names?\b/i, /\bnam(e|es|ed|ing) (a |the |your |new )?files?\b/i, /\bnaming\b/i, /\bkebab/i, /\brecord (every|each|all|the|your) changes?\b/i, /\bchangesets?\b/i],
  R2: [/\blint/i, /\bformat/i, /\bruff\b/i, /\bblack\b/i, /\bisort\b/i, /\bflake8\b/i, /\bmypy\b/i, /\bpyright\b/i, /\bprettier\b/i, /\beslint\b/i, /\bbiome\b/i, /\bpre-?commit\b/i, /\bprecheck/i, /\bchecks?\b/i, /\bcheck(ing|er|ers)\b/i, /\btype-?check/i, /\bfinish/i, /\bdone\b/i, /\bbefore (you |the )?(submit|complet|wrap|hand|return|end)/i, /\bcomplet(e|es|ed|ing|ion)\b/i, /\bverif(y|ies|ied|ying|ication)\b/i, /\bvalidat/i, /\bci\b/i, /\bmake (check|lint|fmt|format)\b/i, /\bscripts?\//i, /\bfinal (step|steps|pass)\b/i],
  R3: [/\btests?\b/i, /\btest(s|ing|ed|er)\b/i, /test_/i, /_test\b/i, /\bpytest\b/i, /\bunittest\b/i, /\bfixtures?\b/i, /\bcoverage\b/i, /\bspecs?\b/i, /\bassert/i, /\btdd\b/i],
  R4: [/commit/i, /\bgit/i, /\bstash/i, /\bworking (tree|copy)\b/i, /\breset\b/i, /\bcheckout\b/i, /\bsign(ed)?[- ]?off/i, /\bdco\b/i, /\bgit\b/i, /\bbranch/i, /\bpush/i, /\bpull[- ]requests?\b/i, /\bprs?\b/i, /\bmerg(e|es|ed|ing)\b/i, /\brebase/i, /\bgithub\b/i, /\bstag(e|ed|ing)\b/i, /\bhistory\b/i],
  R5: [/\bnotes?\b/i, /\blook(ing)? ?up\b/i, /\bsearch/i, /\bgrep\b/i, /\bbefore (your |you |the |any )?(first )?(edit|edits|editing|change|changes|changing|making|modify|modifying|start|starting|touch|touching|writ)/i, /\bfirst edit/i, /\bmodules?\b/i],
  R6: [/\bdiffs?\b/i, /\bstaged\b/i, /\bpatch/i, /\breview (your|the|all) (own )?(changes|work|edits)\b/i, /\bunintended\b/i, /\bdid not mean\b/i],
  blocks_one_turn: [/\bask(ing)? (the |a )?(user|human|me|them|owner|maintainers?)\b/i, /\bask (first|before|for (clarification|confirmation|permission|approval|input|help))\b/i, /\balways ask\b/i, /\bconfirm(ing)? (with|before|first)\b/i, /\bconfirmation\b/i, /\bcheck(ing)? (in )?with (the )?(user|human|me|owner|team)\b/i, /\bwait(ing)? for (the )?(user|human|me|owner|approval|confirmation|input|a reply|review|sign)/i, /\b(user|human|owner)('s)? (approval|permission|confirmation|consent|input|go-ahead|sign)/i, /\bclarif(y|ying|ication)/i, /\bpermission\b/i, /\bapprov(al|e|ed)\b/i, /\bbefore (proceeding|acting|continuing|going ahead)\b/i, /\b(don'?t|do not|never) (make )?assum/i, /\bconsult (the |a )?(user|human|owner)/i, /\bunless (the )?(user|human) (asks|says|requests|explicitly)/i, /\b(user|human) explicitly/i, /\bif (you are |you're )?(unsure|uncertain|in doubt)\b/i],
  missing_tool: [/\bbd\b/, /\bbeads?\b/i, /\bjira\b/i, /\blinear\b/i, /\bissue ?trackers?\b/i, /\bissues?\b/i, /\btickets?\b/i, /\bmcp\b/i, /\bdocker/i, /\bcompose\b/i, /\bpodman\b/i, /\bkubectl\b|\bkubernetes\b|\bk8s\b/i, /\bterraform\b/i, /\bmakefile\b/i, /\x60make\s+[\w-]+/i, /^\s*(?:[-*+]\s+|\d+[.)]\s+)?make\s+[\w-]+\s*$/im, /\bmake\s+(install|build|run|dev|up|down|start|serve|clean|deps|setup|all|db|migrate|docs|release|deploy|bootstrap)\b/i, /\bjustfile\b|\x60just\s+[\w-]+/i, /\bslack\b/i, /\bnotion\b/i, /\btodoist\b/i, /\bconfluence\b/i, /\btrello\b/i, /\basana\b/i, /\bsentry\b/i, /\bdatadog\b/i, /\bplaywright\b/i, /\bpuppeteer\b/i, /\bselenium\b/i, /\bbrowser\b/i, /\btmux\b/i, /\bpostgres|\bpsql\b|\bmysql\b|\bredis\b|\bmongo/i, /\bsupabase\b|\bfirebase\b|\bvercel\b|\bheroku\b|\bnetlify\b/i, /\baws\b|\bgcloud\b|\bazure\b/i, /\bsubagents?\b|\bskills?\b|\bslash commands?\b|\bhooks?\b/i, /\bmemory (bank|file|tool|server)\b/i, /\btodo ?(list|write)\b|\btodowrite\b/i, /\bweb ?search\b|\bweb ?fetch\b/i],
  network: [/\binstall/i, /\bpip\b/i, /\buv\b/i, /\bnpm\b/i, /\bnpx\b/i, /\bpnpm\b/i, /\byarn\b/i, /\bbun\b/i, /\bpoetry\b/i, /\bconda\b/i, /\bnetwork/i, /\binternet\b/i, /\bonline\b/i, /\bdownload/i, /\bcurl\b/i, /\bwget\b/i, /\bdependenc/i, /\bpackages?\b/i, /\bvenv\b/i, /\bvirtualenv/i, /\bapi keys?\b/i],
};

const SAFETY: Array<[Reason, RegExp]> = [
  ['at_sign', /@/],
  ['link', /https?:\/\/|www\.|\]\(/i],
  ['email', /[A-Za-z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['key', /\b(?:sk-[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/],
  ['key', /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*\S{6,}/i],
  ['rules_file', /\b(?:AGENTS|CLAUDE|GEMINI)\.md\b|copilot-instructions|\.cursorrules|\bsoul\.txt\b|\.hermes\.md/i],
  ['html_comment', /<!--|-->/],
];

/** Common function words of Spanish, Portuguese, French, German and Italian that are not also English words. */
const FOREIGN = new Set(['de', 'que', 'para', 'não', 'nao', 'una', 'une', 'und', 'der', 'il', 'les', 'des', 'del', 'por', 'con', 'ist', 'nicht', 'mit', 'für', 'sur', 'dans', 'pour', 'avec', 'ou', 'os', 'das', 'uma', 'um', 'em', 'da', 'los', 'las', 'el', 'la', 'le', 'du', 'ein', 'eine', 'zu', 'auf', 'den', 'dem', 'sono', 'della', 'che', 'è', 'et', 'como', 'mais', 'também', 'sind', 'wird', 'oder', 'pas', 'est', 'sont', 'sin', 'cuando', 'si', 'lo', 'al', 'nos', 'ao', 'são', 'je', 'vous', 'nous', 'auch', 'sie', 'wenn', 'gli', 'questo', 'sempre', 'siempre', 'toujours', 'immer']);
const ENGLISH = new Set(['the', 'and', 'of', 'to', 'is', 'are', 'for', 'with', 'this', 'that', 'use', 'you', 'your', 'be', 'it', 'in', 'on', 'not', 'or', 'when', 'if', 'all', 'from', 'as', 'by', 'an', 'should', 'must', 'do', 'only', 'before', 'after', 'each', 'any', 'can', 'will', 'we', 'our', 'have', 'has']);

/** A line that is mostly not English: at least 8 letters with under 80% of them A to Z, or at least 6 words with 2 or more
 *  Spanish, Portuguese, French, German or Italian function words and no English ones. */
export function notEnglish(line: string): boolean {
  const letters = line.match(/\p{L}/gu)?.length ?? 0;
  const latin = line.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters >= 8 && latin / letters < 0.8) return true;
  const words = line.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.length >= 6 && words.filter((w) => FOREIGN.has(w)).length >= 2 && !words.some((w) => ENGLISH.has(w));
}

/** Every reason a text matches, in REASONS order; the English check runs line by line. */
export function reasonsOf(line: string): Reason[] {
  const out = new Set<Reason>();
  if (line.split('\n').some(notEnglish)) out.add('not_english');
  for (const [r, pats] of Object.entries(TOPICS) as Array<[Reason, RegExp[]]>) if (pats.some((p) => p.test(line))) out.add(r);
  for (const [r, p] of SAFETY) if (p.test(line)) out.add(r);
  return REASONS.filter((r) => out.has(r));
}

export interface Drop { line: number; lines: number; unit: 'section' | 'code_block' | 'list_item' | 'table_row' | 'paragraph' | 'preamble' | 'html'; reasons: Reason[]; text: string }
export interface Section { heading: string; body: string; first_line: number }
export interface Filtered { sections: Array<Section & { kept: boolean }>; drops: Array<Drop & { section: number }> }

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Split a Markdown file into sections at H1 and H2 headings (both become "## "), deeper headings becoming "### ". Text before
 *  the first heading is the preamble, returned with index -1 and always dropped (it has no heading to sit under). */
export function splitSections(text: string): { preamble: { text: string; lines: number }; sections: Section[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const sections: Section[] = [];
  const pre: string[] = [];
  let cur: { heading: string; body: string[]; first_line: number } | null = null;
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = /^\s*(\x60{3,}|~{3,})/.exec(l);
    if (f) { if (fence === null) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; }
    const h = fence === null && !f ? HEADING.exec(l) : null;
    if (h && h[1]!.length <= 2) {
      if (cur) sections.push({ heading: cur.heading, body: cur.body.join('\n'), first_line: cur.first_line });
      cur = { heading: '## ' + h[2]!.trim(), body: [], first_line: i + 1 };
      return;
    }
    const line = h ? '### ' + h[2]!.trim() : l;
    if (cur) cur.body.push(line); else pre.push(line);
  });
  if (cur) sections.push({ heading: (cur as { heading: string }).heading, body: (cur as { body: string[] }).body.join('\n'), first_line: (cur as { first_line: number }).first_line });
  return { preamble: { text: pre.join('\n'), lines: pre.length }, sections };
}

/** The units of a section body: code blocks, list items (with indented continuation lines), table rows, deeper headings,
 *  HTML comment blocks and paragraphs, each with its first line (0-based within the body) and its lines. Blank lines are
 *  separators and belong to no unit. */
export function units(body: string): Array<{ kind: Drop['unit'] | 'heading'; start: number; lines: string[] }> {
  const ls = body.split('\n');
  const out: Array<{ kind: Drop['unit'] | 'heading'; start: number; lines: string[] }> = [];
  let i = 0;
  while (i < ls.length) {
    const l = ls[i]!;
    if (!l.trim()) { i++; continue; }
    const f = /^\s*(\x60{3,}|~{3,})/.exec(l);
    if (f) {
      const mark = f[1]!;
      let j = i + 1;
      while (j < ls.length && !new RegExp('^\\s*' + (mark[0] === '~' ? '~' : '\\x60') + '{' + mark.length + ',}\\s*$').test(ls[j]!)) j++;
      out.push({ kind: 'code_block', start: i, lines: ls.slice(i, Math.min(j + 1, ls.length)) });
      i = j + 1;
      continue;
    }
    if (/^\s*<!--/.test(l)) {
      let j = i;
      while (j < ls.length && !/-->/.test(ls[j]!)) j++;
      out.push({ kind: 'html', start: i, lines: ls.slice(i, Math.min(j + 1, ls.length)) });
      i = j + 1;
      continue;
    }
    if (/^###/.test(l)) { out.push({ kind: 'heading', start: i, lines: [l] }); i++; continue; }
    if (/^\s*\|/.test(l)) { out.push({ kind: 'table_row', start: i, lines: [l] }); i++; continue; }
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s+/.exec(l);
    if (item) {
      const indent = item[1]!.length;
      let j = i + 1;
      while (j < ls.length) {
        const n = ls[j]!;
        if (!n.trim()) {
          let k = j;
          while (k < ls.length && !ls[k]!.trim()) k++;
          if (k < ls.length && ls[k]!.length - ls[k]!.trimStart().length > indent) { j = k; continue; }
          break;
        }
        const ind = n.length - n.trimStart().length;
        if (ind <= indent && /^\s*(?:[-*+]|\d+[.)])\s+|^#|^\s*\||^\s*(\x60{3,}|~{3,})/.test(n)) break;
        j++;
      }
      while (j > i + 1 && !ls[j - 1]!.trim()) j--;
      out.push({ kind: 'list_item', start: i, lines: ls.slice(i, j) });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < ls.length && ls[j]!.trim() && !/^\s*(?:[-*+]|\d+[.)])\s+|^\s*\||^#|^\s*(\x60{3,}|~{3,})/.test(ls[j]!)) j++;
    out.push({ kind: 'paragraph', start: i, lines: ls.slice(i, j) });
    i = j;
  }
  return out;
}

/** Filter one source file. reserved: headings the planted sections use, which filler may not repeat. */
export function filterFile(text: string, reserved: readonly string[] = []): Filtered & { preamble: Drop | null } {
  const { preamble, sections } = splitSections(text);
  const out: Filtered & { preamble: Drop | null } = { sections: [], drops: [], preamble: null };
  if (preamble.text.trim()) out.preamble = { line: 1, lines: preamble.lines, unit: 'preamble', reasons: reasonsOf(preamble.text), text: clip(preamble.text) };
  sections.forEach((s, si) => {
    const headingReasons = reasonsOf(s.heading.replace(/^#+\s*/, ''));
    if (reserved.includes(s.heading)) headingReasons.push('heading_clash');
    if (headingReasons.length) {
      out.drops.push({ section: si, line: s.first_line, lines: s.body.split('\n').length + 1, unit: 'section', reasons: headingReasons, text: clip(s.heading + '\n' + s.body) });
      out.sections.push({ ...s, body: '', kept: false });
      return;
    }
    const us = units(s.body);
    const keep: string[] = [];
    let pendingHeading: string | null = null;
    let droppedUnder: Reason[] | null = null;
    for (const u of us) {
      if (u.kind === 'heading') {
        const r = reasonsOf(u.lines[0]!.replace(/^#+\s*/, ''));
        droppedUnder = r.length ? r : null;
        pendingHeading = r.length ? null : u.lines[0]!;
        if (r.length) out.drops.push({ section: si, line: s.first_line + 1 + u.start, lines: 1, unit: 'section', reasons: r, text: clip(u.lines[0]!) });
        continue;
      }
      if (droppedUnder) {
        out.drops.push({ section: si, line: s.first_line + 1 + u.start, lines: u.lines.length, unit: u.kind as Drop['unit'], reasons: droppedUnder, text: clip(u.lines.join('\n')) });
        continue;
      }
      const r = reasonsOf(u.lines.join('\n'));
      if (r.length) { out.drops.push({ section: si, line: s.first_line + 1 + u.start, lines: u.lines.length, unit: u.kind as Drop['unit'], reasons: r, text: clip(u.lines.join('\n')) }); continue; }
      if (pendingHeading) { keep.push(pendingHeading); pendingHeading = null; }
      keep.push(u.lines.join('\n'));
    }
    const body = keep.join('\n\n').trim();
    out.sections.push({ ...s, body, kept: body.length > 0 });
  });
  return out;
}

function clip(s: string): string {
  return s.length > 300 ? s.slice(0, 300) + '...' : s;
}
