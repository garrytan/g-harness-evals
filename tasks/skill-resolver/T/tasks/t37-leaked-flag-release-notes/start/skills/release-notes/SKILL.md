---
name: release-notes
description: Draft customer-facing release notes for a Lantern release from the merged PR list. Use when asked for release notes, a changelog for customers, or "what shipped".
---

# Release notes

1. Get the merged PRs since the last tag: `gh pr list --state merged --base main --search "merged:>=<last tag date>"`.
2. Keep only user-visible changes. Skip refactors, CI and dependency bumps.
3. Group under **New**, **Improved** and **Fixed**. One line per change, in plain words a customer understands, no PR numbers.
4. Save the draft as `release-notes/<version>.md`.
5. Run `scripts/check.sh release-notes/<version>.md` from this folder and fix anything it reports.
6. Post the draft in #releases for Mira to approve. Never publish it yourself.
