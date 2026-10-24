// The brain builder's page list (gbrain/build-brain.ts): exactly the bot-visible slice of the world for a split,
// so the brain changes retrieval and not information access (docs/gbrain-arm.md).

import { expect, test } from 'bun:test';
import { keylessEnv, pageList } from '../gbrain/build-brain.ts';
import { world } from './world-helpers.ts';

test('held-out: the 7 channel pages and 18 public files, no DM page, no team or private file', () => {
  const pages = pageList(world, 'heldout');
  expect(pages.filter((p) => p.kind === 'channel').length).toBe(7);
  expect(pages.filter((p) => p.kind === 'file').length).toBe(18);
  for (const p of pages) expect(p.page_slug).toBe(`heldout/${p.slug}`);
  const dmSlugs = world.channels.filter((c) => c.kind === 'dm').flatMap((c) => c.source_slugs);
  for (const s of dmSlugs) expect(pages.some((p) => p.slug === s)).toBe(false);
  const nonPublic = world.files.filter((f) => f.visibility !== 'public').map((f) => f.slug);
  for (const s of nonPublic) expect(pages.some((p) => p.slug === s)).toBe(false);
  expect(pages.some((p) => p.slug === 'chats/coastal-team-banter')).toBe(true);
  expect(pages.some((p) => p.slug === 'agent-notes/strategic-cheatsheet')).toBe(true);
  expect(new Set(pages.map((p) => p.page_slug)).size).toBe(pages.length);
});

test('dev: 7 channel pages and 11 public files', () => {
  const pages = pageList(world, 'dev');
  expect(pages.filter((p) => p.kind === 'channel').length).toBe(7);
  expect(pages.filter((p) => p.kind === 'file').length).toBe(11);
  expect(pages.some((p) => p.slug === 'chats/2026-04-23-marrow-renewal-chat')).toBe(false);
});

test('the environment gbrain runs in carries no provider key', () => {
  const env = keylessEnv('/tmp/x');
  for (const k of Object.keys(env)) expect(k).not.toMatch(/API_KEY|_KEY$|TOKEN|SECRET/);
  expect(env.GBRAIN_HOME).toBe('/tmp/x');
  expect(env.HOME).toBe('/tmp/x');
});
