// The public export replaces work-lane codes (an upper-case prefix, a dash and a number) with lettered placeholders
// (internal-task-a) in every published file except the files a hash pins, which stay byte-identical. A test that compares a
// pinned harness file's output with a fixture copy compares modulo that replacement, so it passes in this repository and in
// the public copy alike.
const CODE = /\b(?:[A-Z]{3,4}-[0-9]+|internal-task(?:-[a-z]+)?)\b/g;
export const codeless = (s: string): string => s.replace(CODE, '<code>');
export const codelessFiles = (files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, codeless(v)]));
