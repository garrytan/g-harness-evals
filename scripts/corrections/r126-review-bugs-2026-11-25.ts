#!/usr/bin/env bun
/**
 * Rebuilds docs/corrections/2026-11-25/sensitivity.json: the R126 third-model check of review-real-bugs' judges (internal-task).
 * It scores the committed Gemini 4 Neon labels in docs/corrections/2026-11-25/third-model/ against the judges' rulings
 * and the labellers' answers, which are in the run's private raw archive (raw-review-real-bugs-2026-11-stage2-grading),
 * so it needs that archive unpacked. No model is called.
 *
 *   bun scripts/corrections/r126-review-bugs-2026-11-25.ts --archive <unpacked archive dir> --out <sensitivity.json>
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { score } from '../review-bugs/third-model-score.ts';

const i = process.argv.indexOf('--archive'), o = process.argv.indexOf('--out');
if (i < 0 || o < 0) throw new Error('usage: r126-review-bugs-2026-11-25.ts --archive <dir> --out <file>');
const A = process.argv[i + 1]!;
const T = join(import.meta.dir, '..', '..', 'docs', 'corrections', '2026-11-25', 'third-model');
const matchCheck = (dir: string, labels: string, judge: string, ...more: string[]) => score(['match', '--prompts', join(A, dir, 'prompts'), '--items', join(A, dir, 'items.json'), '--labels', join(T, labels),
  '--answers', join(A, dir, 'run/gpt-6-astra/answers.json'), '--answers', join(A, dir, 'run/claude-opus-5-5/answers.json'), '--judge', judge, ...more]);
const adj = (check: string, rulings: string, primary: string) => score(['adjudicate', '--sample', join(T, 'sample.json'), '--check', check, '--labels', join(T, 'adjudicate-' + check + '.jsonl'),
  '--rulings', join(A, rulings), '--primary', primary]);
const out = {
  labeller: 'google:gemini-4-neon, thinkingLevel medium, through runner/proxy/metering-proxy.ts',
  anchors: { match: score(['anchors', '--key', join(T, 'anchors-match-key.json'), '--labels', join(T, 'match-anchors.jsonl')]),
    adjudicate: score(['anchors', '--key', join(T, 'anchors-adjudicate-key.json'), '--labels', join(T, 'anchors-adjudicate.jsonl')]) },
  match: { stage1: matchCheck('in/grade/grading/labels', 'match-s1.jsonl', 'stage 1 matcher (openai:gpt-6-astra)',
    '--adjudicate-judge', 'stage 1 blind adjudication judge, whose check failed (kappa 0.012) and was replaced by the re-judge'),
    c2: matchCheck('grading/labels-c2', 'match-c2.jsonl', 'C2 matcher (anthropic:claude-opus-5-5)') },
  adjudicate: { rejudge: adj('rejudge', 'in/s2/rejudge/run-1/rulings.jsonl', 'openai:gpt-6-astra'), c1: adj('c1', 'grading/tj-c1-3/rulings.jsonl', 'openai:gpt-6-astra'),
    c2: adj('c2', 'grading/tj-c2-3/rulings.jsonl', 'anthropic:claude-opus-5-5'), c3: adj('c3', 'grading/tj-c3-1/rulings.jsonl', 'openai:gpt-6-astra') },
};
writeFileSync(process.argv[o + 1]!, JSON.stringify(out, null, 2) + '\n');
