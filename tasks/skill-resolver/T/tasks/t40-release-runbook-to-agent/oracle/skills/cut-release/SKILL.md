---
name: cut-release
description: Cut a tidepool-cli release on request. Picks the version, updates package.json and CHANGELOG.md, tags, watches the publish and announces in #releases.
disable-model-invocation: true
---

# Cut a tidepool-cli release

Run only when someone invokes /cut-release. Source: docs/release-runbook.md.

## Workflow

1. Check main is green.
   - Read the latest CI run on main.
   - If it is red, stop and tell #releases.
   - **Done when:** the latest main CI run is green, or the release is stopped and #releases is told why.

2. Pick the version.
   - List merged PRs since the last tag: `git log --merges vLAST..main`.
   - Breaking change while pre-1.0: minor bump. Otherwise: patch bump.
   - **Done when:** the new version vX.Y.Z is chosen and the reason (breaking or not) is stated.

3. Update package.json and CHANGELOG.md.
   - Set "version" in package.json to X.Y.Z.
   - Add a CHANGELOG.md section for vX.Y.Z, one line per merged PR, grouped under Added, Fixed and Changed.
   - **Done when:** package.json shows X.Y.Z and CHANGELOG.md has a vX.Y.Z section covering every merged PR from step 2.

4. Open the release PR.
   - Commit as "release: vX.Y.Z" and open a PR.
   - **Done when:** the PR is approved once and merged.

5. Tag and publish.
   - Tag the merge commit vX.Y.Z and push the tag; the tag push starts the release workflow.
   - Watch the workflow until it finishes. If it fails, do not re-tag; fix forward with a patch release.
   - **Done when:** the release workflow for vX.Y.Z has finished green.

6. Verify and announce.
   - Run `npm view tidepool-cli version`.
   - Post the vX.Y.Z changelog section in #releases.
   - **Done when:** npm reports X.Y.Z and the changelog section is posted in #releases.
