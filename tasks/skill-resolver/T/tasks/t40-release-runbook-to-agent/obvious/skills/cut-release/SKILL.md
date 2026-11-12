---
name: cut-release
description: Release procedure for tidepool-cli. Run only when a maintainer explicitly asks for a release.
disable-model-invocation: true
---

# Cut a tidepool-cli release

Only run this when a maintainer explicitly invokes it. Never start a release on your own initiative.

## Before you start

- You need push access to tags and the ability to open PRs.
- Confirm with the person which version they expect if it is not obvious.

## Steps

1. **Check CI on main.** If the latest run on main is red, stop and post in #releases explaining why the release is blocked.
2. **Choose the version.** Look at `git log --merges vLAST..main`. While we are pre-1.0, breaking changes mean a minor bump; everything else is a patch bump.
3. **Bump package.json.** Set "version" to the new X.Y.Z.
4. **Update CHANGELOG.md.** Add a section for vX.Y.Z with one line per merged PR, grouped under Added, Fixed and Changed.
5. **Open the release PR.** Commit as "release: vX.Y.Z", open a PR and wait for one approval.
6. **Tag after merge.** Tag the merge commit vX.Y.Z and push the tag. This triggers the release workflow that publishes to npm.
7. **Watch the release workflow.** If it fails, do not re-tag. Fix forward with a new patch release.
8. **Verify on npm.** `npm view tidepool-cli version` should print the new version.
9. **Announce.** Post the new changelog section in #releases.

## If something goes wrong

- Red CI on main: stop before step 2.
- Failed publish: never move or delete the tag; cut a patch release with the fix.
