# Ship: Fully Automated Ship Workflow

- Merge the base branch (BEFORE tests)
- Run tests (on merged code)
- Run every applicable suite; do not assume Rails or Vitest.
- Put the entry where the repo's own rule puts unit-PR notes (its CHANGELOG preamble or a fragment directory it names), else under `## [Unreleased]`, never under a released heading.
- Use `git diff origin/<base>` and inspect untracked files from `git status` to see the full proposed change.
- **IRON LAW: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.**
- `git push -u origin <branch-name>`
- Never force-push.