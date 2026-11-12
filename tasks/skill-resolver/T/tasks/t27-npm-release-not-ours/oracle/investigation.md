# Forensic Investigation Report

## Executive Summary

**Target Repository**: `quillcache` (npm package and its git repository)
**Investigation Period**: 2026-10-02 to 2026-11-06
**Verdict**: Compromised
**Confidence Level**: High
**Report Date**: 2026-11-06

quillcache 3.2.1 was published to npm on 2026-11-01 03:12 UTC under the maintainer's account [EV-0002] but has no matching tag or commit in git [EV-0001], and the maintainer states she did not publish it [EV-0004]. The tarball adds a postinstall script that posts the host name and every environment variable to cdn.quill-telemetry.net [EV-0003]. The most likely path is the npm token leaked in a public CI log on 2026-10-30 [EV-0004]. Anyone who installed 3.2.1 should treat the secrets in that environment as exposed.

## Evidence Registry

| ID | Type | Source | Actor | Verification | Event Timestamp | Location |
|---|---|---|---|---|---|---|
| EV-0001 | git | evidence/git-log.txt | Mira Okafor | [UNVERIFIED] single export | 2026-10-24T07:40:55Z | git log v3.2.0..main, tag list |
| EV-0002 | registry | evidence/npm-view.json | mira-okafor (npm) | [UNVERIFIED] single export | 2026-11-01T03:12:44Z | npm view quillcache |
| EV-0003 | artifact | evidence/tarball-diff.patch | unknown | [VERIFIED] matches EV-0002 postinstall field | 2026-11-01T03:12:44Z | diff 3.2.0 vs 3.2.1 tarballs |
| EV-0004 | statement | evidence/maintainer-email.txt | Mira Okafor | [UNVERIFIED] statement | 2026-11-06T08:31:00Z | email |

## Timeline of Events

| Timestamp (UTC) | Event | Evidence IDs |
|---|---|---|
| 2026-10-02T10:11:03Z | 3.2.0 published | [EV-0002] |
| 2026-10-24T07:40:55Z | Changelog commit for 3.2.1 marked unreleased | [EV-0001] |
| 2026-10-30 | CI job release-dry-run prints the npm publish token in a public log | [EV-0004] |
| 2026-11-01T03:12:44Z | 3.2.1 published as mira-okafor, gitHead null, postinstall added | [EV-0002], [EV-0003] |
| 2026-11-06T08:05:00Z | Token revoked by the maintainer | [EV-0004] |

## Validated Hypotheses

### Hypothesis 1: Credential leak led to an unauthorized publish
**Status**: VALIDATED
**Claim**: An attacker used the npm token leaked in the Oct 30 CI log to publish 3.2.1 with a malicious postinstall.
**Supporting Evidence**: [EV-0002] publish with no gitHead at 03:12 UTC; [EV-0001] no v3.2.1 tag or release commit; [EV-0003] exfiltrating postinstall; [EV-0004] token exposure and denial.
**Counter-Evidence Considered**: the maintainer published by mistake from a local tree. Unlikely: no matching commit, the postinstall is not in the repository [EV-0001], and she denies it [EV-0004]. The CI log itself has not been collected yet, so the leak is single-source.
**Confidence**: High for "not a legitimate release"; Medium for the exact token path until the CI log is preserved.

### Hypothesis 2: Maintainer account takeover through password reuse
**Status**: INCONCLUSIVE
**Claim**: The npm account itself, not just the token, was taken over.
**Supporting Evidence**: [EV-0002] publish as mira-okafor only. No login history was collected.

## Indicators of Compromise (IOC List)

| Type | Value | Source | Evidence |
|---|---|---|---|
| PACKAGE_NAME | quillcache@3.2.1 | inferred | [EV-0002] |
| MALICIOUS_URL | https://cdn.quill-telemetry.net/c | inferred | [EV-0003] |
| DOMAIN | cdn.quill-telemetry.net | inferred | [EV-0003] |
| FILE_PATH | package/scripts/setup.js | inferred | [EV-0003] |
| ACTOR_USERNAME | mira-okafor (npm, account used for the publish) | inferred | [EV-0002] |
| API_KEY | npm publish token printed by release-dry-run: [REDACTED] | user-provided | [EV-0004] |
| OTHER | tarball shasum c41d8e2b9a7f03e6d5c1b2a4f6e8d0c9b7a5f3e1 | inferred | [EV-0002] |

## Affected Versions

| Version | Published | Contains Malicious Code | Evidence |
|---|---|---|---|
| 3.2.1 | 2026-11-01 | Yes | [EV-0003] |
| 3.2.0 | 2026-10-02 | No (diff baseline) | [EV-0003] |

## Chain of Custody

All four files were exported by the maintainer on 2026-11-06 and handed over in evidence/. Nothing was fetched live. Not yet collected: the CI log of release-dry-run (Oct 30), npm account audit log, download counts for 3.2.1.

## Recommendations

- Deprecate 3.2.1 and ask npm to unpublish it; publish 3.2.2 from a tagged commit.
- Tell users that installing 3.2.1 sent every environment variable to cdn.quill-telemetry.net [EV-0003]; they should rotate secrets present at install time.
- Save the release-dry-run log before deleting it, then remove the debug step; move publishing to trusted publishing with provenance.
- Block cdn.quill-telemetry.net in egress where possible.
