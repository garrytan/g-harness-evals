// Planted-fact tokens for the owner-identity bank: pronounceable alphabetic pseudo-words of 6 to 10 letters, built from
// fixed syllable tables. A token is refused when it, its plural or its singular is in english-words.txt (every word of 5 to
// 11 letters from Alan Beale's 12dicts 2of12 list, version 6.0.2, released by its author to the public domain; 31,917
// words, a superset of the common words), when it contains a blocklisted real name or brand (world/brain/names.ts), or when
// it collides with a token or name already issued. Two strings collide when, lower-cased and with a final plural "s" or
// "es" removed, one contains the other, so case- and plural-insensitive matching can never confuse two of them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKLIST, type Rng } from '../brain/names.ts';

const ONSET = ['b', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'dr', 'gr', 'kr', 'tr', 'st', 'pl', 'fr', 'sk', 'th'] as const;
const NUCLEUS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o'] as const;
const CODA_MID = ['', '', '', 'n', 'l', 'r', 'm', 's'] as const;
const CODA_END = ['n', 'l', 'r', 'm', 'x', 'th', 'k', 'v', 'sk', 'nd'] as const;

let english: Set<string> | null = null;
export function englishWords(): Set<string> {
  english ??= new Set(readFileSync(join(import.meta.dir, 'english-words.txt'), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean));
  return english;
}

export const stem = (s: string) => {
  const l = s.toLowerCase();
  return l.endsWith('es') && l.length > 6 ? l.slice(0, -2) : l.endsWith('s') && l.length > 5 ? l.slice(0, -1) : l;
};

export const collides = (a: string, b: string) => { const x = stem(a), y = stem(b); return x.includes(y) || y.includes(x); };

export function isEnglish(word: string): boolean {
  const w = englishWords();
  const l = word.toLowerCase();
  return w.has(l) || w.has(l + 's') || w.has(l + 'es') || (l.endsWith('s') && w.has(l.slice(0, -1))) || (l.endsWith('es') && w.has(l.slice(0, -2)));
}

export const hasBlocked = (word: string) => BLOCKLIST.some((b) => word.toLowerCase().includes(b.toLowerCase().replace(/ /g, '')) && b.length >= 4);

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function pseudoWord(r: Rng, syllables: number, end = true): string {
  let w = '';
  for (let i = 0; i < syllables; i++) w += r.pick(ONSET) + r.pick(NUCLEUS) + (i === syllables - 1 && end ? r.pick(CODA_END) : r.pick(CODA_MID));
  return w;
}

export class TokenPool {
  readonly issued: string[] = [];
  private readonly reserved: string[];

  constructor(private readonly r: Rng, reserved: string[] = []) {
    this.reserved = reserved.flatMap((n) => n.split(/[^A-Za-z]+/)).filter((p) => p.length >= 3);
  }

  ok(word: string): boolean {
    return word.length >= 6 && word.length <= 10 && !isEnglish(word) && !hasBlocked(word)
      && !this.issued.some((t) => collides(t, word)) && !this.reserved.some((n) => collides(n, word));
  }

  reserve(word: string): void { this.reserved.push(word); }

  next(): string {
    for (let i = 0; i < 10_000; i++) {
      const w = capitalise(pseudoWord(this.r, this.r.int(2, 3)));
      if (this.ok(w)) { this.issued.push(w); return w; }
    }
    throw new Error('token pool exhausted');
  }
}
