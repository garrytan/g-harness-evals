# harbor-cli

TypeScript CLI that syncs harbor manifests to S3-compatible storage.

## Conventions

- Source in src/, tests next to the code as *.test.ts.
- Never commit generated files under dist/.

## Quality checks

Run these before opening a PR (all are npm scripts in package.json):

| Check | Command | Tool |
|---|---|---|
| Type check | `npm run typecheck` | tsc --noEmit |
| Lint | `npm run lint` | biome check . |
| Tests | `npm test` | vitest run |
| Unused code | `npm run unused` | knip |
| Shell scripts | `shellcheck scripts/*.sh` | shellcheck (not in CI) |

Use the npm scripts rather than calling the tools directly, so flags stay in one place.
