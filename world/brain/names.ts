// Coined names for the qm-brain-native corpus (K8). Every name is invented: surnames and company roots are built from fixed
// syllable tables, first names are common given names, and checkNames refuses a corpus whose names collide with each other
// (outside the planned ambiguity and decoy pairs) or contain a blocklisted real company or famous person. The exact-phrase web
// check of the company name is done by hand at freeze and recorded in the preregistration; nothing here touches the network.

export const COMPANY_NAME = 'Quessaly Robotics';

export const FIRST_NAMES = [
  'Ada', 'Ben', 'Cara', 'Dev', 'Elif', 'Femi', 'Gita', 'Hugo', 'Ines', 'Jonah', 'Kiri', 'Leon', 'Maya', 'Nico', 'Oona', 'Pavel',
  'Rhea', 'Sami', 'Tara', 'Umar', 'Vera', 'Wes', 'Yuki', 'Zane', 'Anya', 'Bruno', 'Chloe', 'Dario', 'Esme', 'Felix', 'Greta',
  'Hana', 'Ivo', 'Jade', 'Kofi', 'Lena', 'Milo', 'Nadia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Soren', 'Theo', 'Uma', 'Vik',
  'Wren', 'Xavi', 'Yara', 'Zora', 'Amir', 'Bea', 'Cyrus', 'Dina', 'Emil', 'Faye', 'Gus', 'Hedda', 'Ilan', 'Juno',
] as const;

const SUR_A = ['Al', 'Bren', 'Cor', 'Dal', 'Ev', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lun', 'Mar', 'Nor', 'Ost', 'Pell', 'Quen', 'Ros', 'Sel', 'Tav', 'Ul', 'Ver', 'Wyn', 'Yar', 'Zel'] as const;
const SUR_B = ['bury', 'croft', 'dane', 'ford', 'grove', 'holm', 'ick', 'lowe', 'mere', 'ney', 'ock', 'rath', 'sby', 'stead', 'tine', 'ward', 'wick', 'yn'] as const;
const CO_A = ['Quill', 'Vell', 'Orr', 'Tamber', 'Brix', 'Calder', 'Dunmor', 'Eskel', 'Farrow', 'Glenth', 'Harrow', 'Ilsen', 'Juno', 'Kestrel', 'Lomb', 'Merrin', 'Nettle', 'Oster', 'Pryce', 'Rendle', 'Saffer', 'Thorn', 'Umber', 'Varn', 'Whit', 'Yelm'] as const;
const CO_B = ['ac', 'ane', 'ara', 'en', 'ex', 'ia', 'ine', 'ion', 'is', 'ly', 'ora', 'um', 'yx'] as const;
const CO_C = ['Labs', 'Systems', 'Logistics', 'Foods', 'Health', 'Materials', 'Freight', 'Analytics', 'Energy', 'Retail', 'Components', 'Robotics'] as const;
export const CODE_A = ['Quill', 'Varn', 'Hask', 'Brill', 'Tusk', 'Morv', 'Pell', 'Sorr', 'Gant', 'Wick', 'Dorn', 'Fenn', 'Lisk', 'Corv', 'Rusk', 'Tamb'] as const;
export const CODE_B = ['fen', 'holt', 'mire', 'wold', 'gale', 'brook', 'stane', 'thorpe', 'ridge', 'marsh', 'combe', 'ley'] as const;

/** Real companies, products and famous people a coined name must not contain (case-insensitive, whole words). */
export const BLOCKLIST = [
  'Google', 'Alphabet', 'Apple', 'Microsoft', 'Amazon', 'Meta', 'Facebook', 'OpenAI', 'Anthropic', 'Nvidia', 'Intel', 'IBM', 'Oracle',
  'Salesforce', 'Stripe', 'Airbnb', 'Tesla', 'SpaceX', 'Uber', 'Lyft', 'Netflix', 'Shopify', 'Samsung', 'Sony', 'Siemens', 'Bosch',
  'Northwind', 'Contoso', 'Fabrikam', 'Acme', 'Initech', 'Globex', 'Umbrella', 'Hooli', 'Particle', 'Hermes', 'QM', 'gbrain', 'gstack',
  'Boston Dynamics', 'Kiva', 'Fetch', 'Locus', 'Covariant', 'Figure', 'Agility', 'Anduril', 'Palantir', 'Ocado', 'Symbotic',
  'Y Combinator', 'Garry Tan', 'Sam Altman', 'Elon Musk', 'Jeff Bezos', 'Tim Cook', 'Satya Nadella',
] as const;

export interface Rng { next(): number; int(lo: number, hi: number): number; pick<T>(xs: readonly T[]): T; shuffle<T>(xs: T[]): T[] }

/**
 * A number seeds mulberry32 (32-bit state, for the power simulations). Four 32-bit words seed sfc32 (128-bit state), which the
 * corpus and task generators use, so a few published names don't narrow a sealed corpus to a searchable set (the sealed seed itself is 32 random bytes).
 */
export function rng(seed: number | readonly [number, number, number, number]): Rng {
  let next: () => number;
  if (typeof seed === 'number') {
    let a = seed >>> 0;
    next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  } else {
    let [a, b, c, d] = seed.map(x => x >>> 0) as [number, number, number, number];
    next = () => {
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 15; i++) next();
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    shuffle: <T>(xs: T[]) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [xs[i], xs[j]] = [xs[j]!, xs[i]!];
      }
      return xs;
    },
  };
}

export const surname = (r: Rng) => r.pick(SUR_A) + r.pick(SUR_B);
export const companyRoot = (r: Rng) => r.pick(CO_A) + r.pick(CO_B);
export const companyName = (r: Rng) => `${companyRoot(r)} ${r.pick(CO_C)}`;
export const codename = (r: Rng) => r.pick(CODE_A) + r.pick(CODE_B);

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

export interface NameProblem { name: string; problem: string }

/**
 * Names must be unique (people by full name, companies by name), may not sit within edit distance 2 of another company name,
 * and may not contain a blocklisted word. allowedPairs lists the deliberate ambiguity and decoy pairs, as "a|b" in either order.
 */
export function checkNames(people: string[], companies: string[], allowedPairs: string[] = []): NameProblem[] {
  const problems: NameProblem[] = [];
  const allowed = new Set(allowedPairs.flatMap(p => { const [a, b] = p.split('|'); return [`${a}|${b}`, `${b}|${a}`]; }));
  const block = BLOCKLIST.map(w => new RegExp(`(^|[^a-z])${w.toLowerCase().replace(/ /g, '\\s+')}($|[^a-z])`));
  for (const n of [...people, ...companies]) {
    const low = n.toLowerCase();
    const hit = block.findIndex(re => re.test(low));
    if (hit >= 0) problems.push({ name: n, problem: `contains the blocklisted name ${BLOCKLIST[hit]}` });
  }
  const dup = (xs: string[], what: string) => {
    const seen = new Map<string, number>();
    for (const x of xs) seen.set(x, (seen.get(x) ?? 0) + 1);
    for (const [x, c] of seen) if (c > 1 && !allowed.has(`${x}|${x}`)) problems.push({ name: x, problem: `${what} appears ${c} times` });
  };
  dup(people, 'person name');
  dup(companies, 'company name');
  const uniq = [...new Set(companies)];
  for (let i = 0; i < uniq.length; i++)
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i]!, b = uniq[j]!;
      if (allowed.has(`${a}|${b}`)) continue;
      if (editDistance(a.toLowerCase(), b.toLowerCase()) <= 2) problems.push({ name: `${a} / ${b}`, problem: 'company names within edit distance 2 (not a declared decoy pair)' });
    }
  return problems;
}
