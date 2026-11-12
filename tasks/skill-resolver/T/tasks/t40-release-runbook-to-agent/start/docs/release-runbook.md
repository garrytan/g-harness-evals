# Cutting a release of tidepool-cli

Whoever is on release duty does this, usually on Thursdays.

1. Make sure main is green in CI. If the latest main run is red, stop and tell #releases.
2. Pick the version. Breaking changes since the last tag mean a minor bump while we are pre-1.0, otherwise a patch bump.
3. Update "version" in package.json.
4. Add a CHANGELOG.md section for the new version from the PRs merged since the last tag (`git log --merges vLAST..main`). One line per PR, grouped under Added, Fixed and Changed.
5. Commit as "release: vX.Y.Z" and open a PR. Get one approval.
6. After merge, tag the merge commit `vX.Y.Z` and push the tag. The tag push starts the release workflow, which publishes to npm.
7. Watch the release workflow until it finishes. If it fails, do not re-tag; fix forward with a patch release.
8. Check `npm view tidepool-cli version` shows the new version.
9. Post the changelog section in #releases.
