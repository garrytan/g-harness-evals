# tidepool-api

Node 22 API for the Tidepool mobile app.

## Commands

- `npm ci` then `npm test` (vitest)
- `npm run dev` starts the server on port 8080

## Code style

- ES modules only, no default exports.
- Every route handler lives in src/routes/ and has a test in test/routes/.

## Deploy Configuration (configured by /setup-deploy)
- Platform: Fly.io
- Production URL: https://api.tidepool.dev
- Deploy workflow: .github/workflows/fly-deploy.yml (flyctl deploy --remote-only on push to main)
- Deploy status command: gh run list --workflow fly-deploy.yml --limit 1 --json headSha,status,conclusion
- Merge method: squash
- Project type: API
- Post-deploy health check: https://api.tidepool.dev/healthz

### Custom deploy hooks
- Pre-merge: npm test
- Deploy trigger: automatic on push to main
- Deploy status: gh run list --workflow fly-deploy.yml --limit 1 --json headSha,status,conclusion
- Health check: https://api.tidepool.dev/healthz
