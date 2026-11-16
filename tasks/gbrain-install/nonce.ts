// internal-task: the per-trial nonce, a made-up word the save turn stores and the recall turn asks for, so recall cannot be
// guessed. It is a pure function of the cell's seed and the trial id: a rerun of the same trial id gets the same word.

import { createHash } from 'node:crypto';

const ONSETS = ['b', 'br', 'd', 'dr', 'f', 'fl', 'g', 'gr', 'k', 'kl', 'l', 'm', 'n', 'p', 'pl', 'r', 's', 'st', 't', 'tr', 'v', 'z', 'th', 'sk'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'ei', 'ou'];
const CODAS = ['b', 'd', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'x', 'nd', 'rn', 'lm', 'mb', 'sk'];

/** A capitalised three-syllable word such as "Vorlimbask", from sha256 of "<seed>:<trial id>". */
export function installNonce(seed: string, trialId: string): string {
  const h = createHash('sha256').update(`${seed}:${trialId}`).digest();
  let word = '';
  for (let i = 0; i < 3; i++) word += ONSETS[h[i * 2]! % ONSETS.length]! + VOWELS[h[i * 2 + 1]! % VOWELS.length]!;
  word += CODAS[h[6]! % CODAS.length]!;
  return word[0]!.toUpperCase() + word.slice(1);
}
