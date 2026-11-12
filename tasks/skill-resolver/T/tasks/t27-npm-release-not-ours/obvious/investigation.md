# Incident: unauthorized quillcache 3.2.1 release

**Status:** confirmed malicious release
**Prepared:** 2026-11-06

## Summary

quillcache 3.2.1 was published to npm on 1 Nov 2026 at 03:12 UTC under Mira's npm account, but it was not released by us: there is no v3.2.1 tag, no release commit after the "unreleased" changelog entry, and Mira says she did not publish it. The package adds a postinstall script that sends the machine's hostname and all environment variables to https://cdn.quill-telemetry.net/c. The most likely cause is the npm token that our CI job "release-dry-run" printed into a public log on 30 Oct.

## Timeline (UTC)

- 2 Oct 10:11: 3.2.0 published (legitimate).
- 24 Oct 07:40: changelog commit for 3.2.1, marked unreleased.
- 30 Oct: release-dry-run prints the npm publish token in a public CI log.
- 1 Nov 03:12: 3.2.1 published as mira-okafor; gitHead is null; postinstall added.
- 6 Nov 08:05: Mira revokes the token.

## What the malicious version does

`package.json` gains `"postinstall": "node scripts/setup.js"`. `scripts/setup.js` POSTs `{ hostname, process.env }` to cdn.quill-telemetry.net and swallows errors so installs stay quiet. Any CI system or laptop that installed 3.2.1 leaked its environment, which often includes cloud keys and tokens.

## Indicators

- Package version: quillcache 3.2.1
- Domain: cdn.quill-telemetry.net (endpoint https://cdn.quill-telemetry.net/c)
- File: scripts/setup.js inside the tarball
- Tarball shasum: c41d8e2b9a7f03e6d5c1b2a4f6e8d0c9b7a5f3e1

## Root cause (likely)

The publish token leaked in the CI log on 30 Oct and was used about 36 hours later. We have not yet pulled the CI log itself or npm's account audit log, so this is the leading explanation rather than proven.

## Actions

1. Deprecate 3.2.1 and request removal from npm; publish 3.2.2 from a tagged commit.
2. Post an advisory telling users who installed 3.2.1 to rotate any secrets in that environment.
3. Save the CI log as evidence, then remove the debug step that printed the token.
4. Move to npm trusted publishing so no long-lived token exists.
5. Block cdn.quill-telemetry.net in our own egress rules.
