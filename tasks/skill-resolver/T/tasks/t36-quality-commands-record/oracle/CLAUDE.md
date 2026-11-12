# harbor-cli

TypeScript CLI that syncs harbor manifests to S3-compatible storage.

## Conventions

- Source in src/, tests next to the code as *.test.ts.
- Never commit generated files under dist/.

## Health Stack

- typecheck: npm run typecheck (tsc --noEmit)
- lint: npm run lint (biome check .)
- test: npm test (vitest run)
- deadcode: npm run unused (knip)
- shell: shellcheck scripts/*.sh
