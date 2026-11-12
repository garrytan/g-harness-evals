# tidepool-api

Node 22 API for the Tidepool mobile app.

## Commands

- `npm ci` then `npm test` (vitest)
- `npm run dev` starts the server on port 8080

## Code style

- ES modules only, no default exports.
- Every route handler lives in src/routes/ and has a test in test/routes/.

## Deploying to production

- **Platform:** Fly.io, app `tidepool-api` (region sea). Config in fly.toml.
- **How it deploys:** merging to main triggers .github/workflows/fly-deploy.yml, which runs `flyctl deploy --remote-only`. Do not deploy by hand.
- **Merging:** squash-merge PRs into main once CI is green.
- **Production URL:** https://api.tidepool.dev (custom domain in front of the Fly app).
- **Checking a deploy:**
  1. Watch the workflow: `gh run list --workflow fly-deploy.yml --limit 1`.
  2. Confirm the app is up: `curl -fsS https://api.tidepool.dev/healthz` should return `{"ok":true,...}` with the new image ref in `version`.
  3. Fly also runs this /healthz check every 15s; `fly status --app tidepool-api` shows the machines.
- **If it breaks:** `fly releases --app tidepool-api` lists releases; `fly deploy --image <previous image>` rolls back.
