# Public safety gate

The public safety gate checks everything that is about to become public in this repository: every commit, every path name, every file version (including versions a later commit deletes), every gzip and tar member, every commit identity, and PR text. It is one command, `scripts/public-safety/check.ts`, and it never prints the text it matched.

It replaces the weekly export's scrub checks. The rules that are safe to publish live in this folder. Rules whose pattern would itself name a private thing live in a private pack that only the push lane and the private checks hold, pinned by sha256.

## Run it

- **A branch** (every object new in `HEAD` relative to the public main):
  `bun scripts/public-safety/check.ts --base origin/main --head HEAD --ref refs/heads/<branch>`
  Add `--private-pack <path>` (and `--pin <path>` if the pin is not at `~/.config/harness-evals/public-safety/pack.sha256`) for the full check, and `--json` for machine output.
- **PR text** (title, body or comment, saved to a file):
  `bun scripts/public-safety/check.ts --pr-text <file> --private-pack <path>`
  Without a pack it prints `not authorizing`: a lint, not a pass. With a pack a pass prints `PUBLIC_SAFETY: ok text=<sha256 of the file>`.
- **The pre-push hook** (git calls this through `.git/hooks/pre-push.local`; you do not run it by hand):
  `bun <pinned copy>/check.ts --hook <remote-name> <remote-url> --private-pack <path> --pin <path>`
  It enforces only when the remote URL's path ends in `garrytan/g-harness-evals` (https, ssh or scp form, with or without a user or `.git`, any host or ssh host alias). A new branch is scanned from its merge base with the fetched public main, a deletion passes without a scan, and each pushed ref is scanned on its own.
- **Lane bring-up**, once per checkout and safe to repeat:
  `bun scripts/public-safety/check.ts --doctor [--pack <path>] [--pin <path>]`
  It verifies the pack against its pin, extracts the gate tree the pack pins into `~/.cache/harness-evals/public-safety/<tree>/`, readies gitleaks, installs `.git/hooks/pre-push.local` (and a `pre-push` that runs it, through gstack's managed hook when gstack is installed), probes this checkout's commit identity, and checks that a canary push through the installed hook is refused. It prints exactly `public-safety: ok` or `public-safety: fail <codes>`, and it never sets `core.hooksPath`.
- **CI** runs the branch form on the pull request range, keyless: `bun scripts/public-safety/check.ts --base <base sha> --head <head sha>`. [CI and the private lane](#ci-and-the-private-lane) says which copy of the gate runs. When `GITHUB_ACTIONS` is set, key-class and private-class findings print only their code and a correlation id; the same id appears at the end of the finding line in a local run.
- **An allowlist entry** for a public-rule finding: `bun scripts/public-safety/check.ts --allow <code> <path>:<line>[,<line>...] --reason <text>` prints an `allow.json` entry bound to the code, the file's current blob id and those lines (an entry may also name a container `member`). It admits that code at those lines only: if the rule matches any other line of the file, the first unlisted line is reported. Any later edit to the file needs a new decision.

The hook runs the cached, pinned copy of the gate, never the checkout's own `check.ts`. A branch that edits `check.ts`, `rules.json`, `allow.json` or a hook file cannot weaken the check that admits it: a gate change takes effect for pushes only after the private pack pins its new tree. Pushing with `--no-verify` to a public remote is forbidden.

What counts as text to scan: every blob a new commit puts at a path, a blob the base already holds included (it is checked against the new path's class and rules); every commit message, header and identity, where the identity gate reads the author, the committer and every `Key: value` message line that carries an email address; every pushed ref name, refused or not, through the rules, the pack and gitleaks; and inside archives, every gzip member's FEXTRA, FNAME and FCOMMENT field, every tar header text field (name, link target, owner and group names, prefix), GNU long-name and long-link records, pax extended and global records, and anything after the first all-zero block. A name gitleaks flags (a path, a tar member or a ref) is withheld from every output channel.

## Exit codes

| Exit | Meaning | Codes |
| --- | --- | --- |
| 0 | Pass. Each scanned ref prints `PUBLIC_SAFETY: ok ref=<ref> head=<sha> gate=<tree12> pack=<pack sha12 or none> objects=<n>`. | none |
| 1 | Content rejected. | every content code below |
| 2 | Usage error. The gate names the bad argument and prints the usage text. | PS-USAGE |
| 3 | Tool or infrastructure failure. | PS-TOOL-DOWNLOAD, PS-TOOL-SHA, PS-TOOL-TIMEOUT, PS-BASE, PS-PACK-MISSING, PS-PACK-SHA, PS-PACK-INVALID, PS-GATE-TREE, PS-INTERNAL |

Each finding prints one line: `<CODE> <locator>:<line> fix: <text> docs: docs/public-safety.md#<code>`. A locator is a path (with `|member` for a container member), `commit:<sha12>:<field>`, `ref:<name>` or `text`. When the path, member or ref name itself matches a rule or a pack value, the gate prints an opaque locator instead (`obj:<blob12>`, `path#<n>` or `ref#<n>`); `git log --all --find-object=<blob>` finds the commit. Control characters are escaped.

## A worked failure

A branch adds a test fixture with a key-shaped string, and a later commit deletes it. The final tree is clean, but the deleted version would still be public in the branch history:

```
$ bun scripts/public-safety/check.ts --base origin/main --head HEAD --ref refs/heads/fixture-fix
PS-KEY-SHAPE tests/fixtures/sample.json:3 fix: Remove the key-shaped string. A test builds its canary at run time from parts; a real key is reported, not rotated by an agent. docs: docs/public-safety.md#ps-key-shape corr=<12 hex digits>
$ echo $?
1
```

Deleting the file in a new commit does not help. Rewrite the branch so no commit ever held the string (for example `git rebase -i origin/main` and drop or edit the commit that added it), build the fixture value at run time from parts, and run the check again until it prints the `PUBLIC_SAFETY: ok` receipt.

## Files

- `scripts/public-safety/check.ts`: the CLI. `lib/` holds the scanning core it shares with the retired export (container expansion, marker matching, the blob stream), bounded process execution, the pinned-tool reader, the private pack reader, the Claude Code reference shingles (`lib/reference.ts`: the reference paths, the tokenizer, the threshold and the common-phrase drop, never reference text, shared by the private pack builder and the export's `reference-overlap` gate), the output boundary, the hook script and the doctor.
- `rules.json`: the public marker rules, the spend path globs, the allowed identity forms, and the fix text of every code.
- `classes.json`: path classes, deny rules, allowed formats and size budgets. Refuses by default.
- `allow.json`: blob-bound exceptions to public-rule findings, each with a reason and a date.
- `tools.lock` and `gitleaks.toml`: the pinned gitleaks and its configuration.

## CI and the private lane

- **`public-safety`** (`.github/workflows/public-safety.yml`) runs on pull request opened, edited, synchronize and reopened. It runs the base commit's copy of `scripts/public-safety` (`git archive <base sha>`) over base..head and over the title and body. This is the check branch protection requires, together with `private-admission`. On `pull_request` GitHub runs the pull request's own copy of the workflow file, so a pull request that edits the workflow could skip this check: that is why it only detects, and private-admission's `PS-POLICY-CHANGE` is the binding check for an edit under `scripts/public-safety/`, `.githooks/`, `.github/workflows/` or `.gstack/pregate.json`.
- **`public-safety-push`** is the same job on a push to any branch. It runs the default branch head's copy of the gate, fetched from origin, never the pushed branch's previous head, over before..after (a new branch starts at its merge base with main). Its distinct name keeps it from standing in for the pull request check on the same head. Branch protection does not require it.
- **`private-admission`** is posted by the private lane after it scans each public head with the private pack. Its states and codes are documented in the private repository.
- **`private-admission-watch`** (`.github/workflows/private-admission-watch.yml`, `scripts/public-safety/watch-private-admission.ts`) runs every 10 minutes. On every open pull request head with no final `private-admission` status whose newest pending status, or failing that its head push, is over 30 minutes old, it posts state `error` with the [PS-PRIV-UNAVAILABLE](#ps-priv-unavailable) description. The lane's next verdict replaces it.
- **`pr-text`** (`.github/workflows/pr-text.yml`) is an alert, not a required check. On every issue comment, review, review comment and issue, it runs main's `check.ts --pr-text` on the event payload's text alone and fails visibly on a hit, so a maintainer edits or hides the text. Outside text is untrusted data and is never executed.

## Docs-only fast path

CI's checks job and the private lane's `ubicloud/checks` skip typecheck and `bun test tests/` for a docs-only change. They run the docs checks instead: `bun test tests/version.test.ts tests/scoreboard.test.ts tests/readme-settings.test.ts` (the three tests that read the README or every Markdown page), plus the link, hub-fragment and preregistration order checks that run anyway. `scripts/ci/docs-only.ts` decides, always from the base commit's copy, so a change can't add its own pages to the list.

The rule is an explicit list (`DOCS` in the script), not a pattern. Every path the change adds, edits, deletes or renames (both names of a rename) must be a regular file on that list, and no committed file may hold the sha256 of its old or new content. Today the list has 17 human-facing pages: `README.md`, a handful of guides under `docs/`, the six `docs/harness-anatomy/` pages and four `findings/` write-ups.

- **What stays off the list:** anything an agent loads as instructions (AGENTS.md, CLAUDE.md, SKILL.md, CREW.md, prompts, templates, rubrics), preregistrations, plans, results, receipts and `changelog.d/` or `todos.d/` fragments. Those keep the full run (R81).
- **How a page joins:** a reviewed change to `scripts/ci/docs-only.ts`, which is code and gets the full run. `tests/docs-only.test.ts` fails if a listed page is missing, pinned or read by any test or script outside the docs checks.
- **How to check it:** `bun scripts/ci/docs-only.ts --audit` counts the listed pages that qualify on a tree. The test runs it on the real tree and expects every listed page to qualify. The word-match rule this replaced qualified 0 of the 1,481 Markdown files on main at 847f77a, so the fast path never ran.

Anything the script can't decide means the full run.

## Codes

<a id="ps-capy-link"></a>
### PS-CAPY-LINK

A file, path name, commit message or PR text holds a link to a Capy session log. Outside readers cannot open it.

**Fix:** Remove the session log link; cite the commit, file or receipt it pointed at instead.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-jam-id"></a>
### PS-JAM-ID

A Capy thread id (the `jam_` prefix and 26 characters) appears in a new object.

**Fix:** Remove the thread id; name the issue code or the commit instead.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-machine-id"></a>
### PS-MACHINE-ID

A Capy machine id appears outside a raw receipt. Receipts (the `receipts` content class) may keep shard provenance.

**Fix:** Remove the machine id, or keep it only in a raw receipt under a receipts path.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-vm-name"></a>
### PS-VM-NAME

A Ubicloud VM name appears outside a raw receipt.

**Fix:** Remove the VM name, or keep it only in a raw receipt under a receipts path.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-drive-path"></a>
### PS-DRIVE-PATH

The Capy drive mount path appears in a new object. It names a private file system. One form is exempt: the bare mount root as a whole JSON string that ends its line (the root in double quotes, with an optional trailing comma and nothing else after it on the line), which is how a clean-arm preflight lists a directory it confirmed is absent. The root followed by anything else on the line is still flagged, so a path under it, a concatenation, adjacent literals and a one-line join all fail. A multi-line call whose first argument is the bare root on its own line is not caught.

**Fix:** Replace the drive mount path with a repository path or a sha256 pin of the file.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-spend-section"></a>
### PS-SPEND-SECTION

A prose file has a heading that opens an internal spend section. Program spend stays in the private ledger notes.

**Fix:** Move the internal spend section out of the public file; it belongs in the private ledger notes.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-spend-total"></a>
### PS-SPEND-TOTAL

A prose line outside `docs/benchmarks/` states a program-wide or eval-level spend total. Run documents state their own run's spend and are not checked.

**Fix:** Drop the program or eval spend total; cost per solved task and cost per trial may stay.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-scanner-suppression"></a>
### PS-SCANNER-SUPPRESSION

A line carries an inline comment that switches a secret scanner off for that line. The gate ignores such comments anyway, and they hide real findings from other scanners.

**Fix:** Remove the inline comment that turns a secret scanner off; split a test literal instead.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-crew-chatter"></a>
### PS-CREW-CHATTER

Prose names the agent crew's internal threads, blocking reports or drive. A collapsed Agent notes section in a commit message or PR text is exempt, and so is `docs/decisions.md`.

**Fix:** Rewrite the sentence for an outside reader, or move it into the collapsed Agent notes section of the PR.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-captain-mention"></a>
### PS-CAPTAIN-MENTION

Prose names the crew lead by title outside run documents (`docs/benchmarks/**/*.md`), `docs/decisions.md`, `CHANGELOG.md` and `changelog.d/`. A collapsed Agent notes section is exempt.

**Fix:** Name the decision or the role in plain words; the crew lead's title is allowed only in run documents, decisions and the changelog.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-key-shape"></a>
### PS-KEY-SHAPE

A string shaped like a model provider API key appears in a new object. This is a key-class finding: in GitHub Actions the gate prints only the code and a correlation id.

**Fix:** Remove the key-shaped string. A test builds its canary at run time from parts; a real key is reported, not rotated by an agent.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-gitleaks"></a>
### PS-GITLEAKS

The pinned gitleaks (8.30.1, run with `--redact` under `scripts/public-safety/gitleaks.toml`) found a credential-shaped string in a new blob, a decoded container member, a commit message, a path name or the PR text. Key-class, like PS-KEY-SHAPE.

**Fix:** Remove the credential-shaped string gitleaks found; for a proven false positive, add a blob-bound allow.json entry with --allow.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-identity"></a>
### PS-IDENTITY

A commit's author or committer address, or an address in any message line of the form `Key: value` (Co-authored-by, Signed-off-by, Reported-by, Cc and every other trailer), is not `noreply@github.com` or `<digits>+<login>@users.noreply.github.com`. A Co-authored-by or Signed-off-by line with no address fails too. The gate never prints the address.

One exception covers the author and committer only. `identity.owner_accepted` in `rules.json` lists the Capy account address, the address commits made on Capy machines carry. As author or committer it raises neither PS-IDENTITY nor PS-PRIVATE-IDENTITY, in any letter case, even though the private pack lists it. Everywhere else it is still refused: in a trailer such as Co-authored-by or Signed-off-by (PS-IDENTITY and PS-PRIVATE-IDENTITY), and in file contents, path names, ref names and the rest of the commit message and header (PS-PRIVATE-VALUE). Before the header goes through the text scans, the gate swaps that address for a noreply address on the author and committer lines only. `rules.json` writes the address with a `\u0040` escape so the file never holds it as plain text, and no other address is accepted this way.

**Fix:** Commit with a GitHub noreply address (<id>+<login>@users.noreply.github.com) or an identity.owner_accepted address as author and committer, and use a noreply address in every message line of the form Key: value that carries an address (Co-authored-by, Signed-off-by and any other trailer), then rewrite the branch.

Not allowlistable.

<a id="ps-spend-path"></a>
### PS-SPEND-PATH

A new object is a spend ledger (`ledger.sqlite`, `*.ledger.sqlite`), a proxy usage log (`proxy-usage*.ndjson`) or a spend reconciliation file (`spend-reconciliation*.json`), even if a later commit deletes it.

**Fix:** Remove the spend ledger, proxy usage log or spend reconciliation file from every commit of the branch; it stays private.

Not allowlistable.

<a id="ps-ref"></a>
### PS-REF

The pushed ref is not a branch under `refs/heads/`, or its name is malformed. Tags and other namespaces are refused even when they add no objects.

**Fix:** Push only branches under refs/heads/; tags and other namespaces are not accepted on the public repository.

Not allowlistable.

<a id="ps-class"></a>
### PS-CLASS

A new path matches no class in `scripts/public-safety/classes.json`, matches one of its deny rules (sealed sets, custody material, the retired export, local configuration), or is a submodule.

**Fix:** The path matches no class in scripts/public-safety/classes.json, or a deny rule there; move the file or add a class in a reviewed change.

Not allowlistable.

<a id="ps-format"></a>
### PS-FORMAT

A new blob is a format its content class does not allow (for example a zip in `docs/`), or a gzip or tar inside it is corrupt, unsupported or over the decode budget.

**Fix:** The file is a format its content class does not allow, or a container is corrupt, unsupported or over budget; commit it as text or a supported container.

Allowlistable with a blob-bound `allow.json` entry.

<a id="ps-size"></a>
### PS-SIZE

A new blob is larger than its content class budget in `classes.json`.

**Fix:** The file is over its content class size budget in classes.json; split it, compress it as gzip, or keep it out of the repository.

Not allowlistable.

<a id="ps-private-value"></a>
### PS-PRIVATE-VALUE

A new object holds a value the private pack lists. Private-class: the gate prints no detail.

**Fix:** Not allowlistable; see the private record.

Not allowlistable.

<a id="ps-private-pattern"></a>
### PS-PRIVATE-PATTERN

A new object matches a pattern the private pack holds. Private-class: the gate prints no detail.

**Fix:** Not allowlistable; see the private record.

Not allowlistable.

<a id="ps-private-identity"></a>
### PS-PRIVATE-IDENTITY

A commit identity is one the private pack lists. Private-class: the gate prints no detail.

**Fix:** Not allowlistable; see the private record.

Not allowlistable.

<a id="ps-private-shingle"></a>
### PS-PRIVATE-SHINGLE

A file, message or PR text shares 20 or more 8-word shingles with a private reference text. Private-class: the gate prints no detail.

**Fix:** Not allowlistable; see the private record.

Not allowlistable.

<a id="ps-usage"></a>
### PS-USAGE

An argument is missing, unknown or malformed. The gate names it and prints the usage text. Exit 2.

**Fix:** Fix the named argument; the usage text lists every invocation.

Not allowlistable.

<a id="ps-tool-download"></a>
### PS-TOOL-DOWNLOAD

The pinned gitleaks could not be downloaded after one retry. Exit 3.

**Fix:** The pinned gitleaks could not be downloaded; check the network and run the command again.

Not allowlistable.

<a id="ps-tool-sha"></a>
### PS-TOOL-SHA

The gitleaks artifact does not match the sha256 in `scripts/public-safety/tools.lock`, or the binary reports another version. Exit 3.

**Fix:** The downloaded tool does not match tools.lock or reports another version; delete the tool cache and run again, and report it if it repeats.

Not allowlistable.

<a id="ps-tool-timeout"></a>
### PS-TOOL-TIMEOUT

A tool or git call passed its deadline. The gate killed its whole process group and removed only the partial files it owned. Exit 3.

**Fix:** A tool or git call passed its deadline and its process group was killed; run again, and report it if it repeats.

Not allowlistable.

<a id="ps-base"></a>
### PS-BASE

The base commit (`--base`, the remote sha of a push, or the merge base with the fetched public main for a new branch) is not in the local repository. Exit 3.

**Fix:** The base commit is not in this repository; fetch the public main (git fetch origin main) and run again.

Not allowlistable.

<a id="ps-pack-missing"></a>
### PS-PACK-MISSING

A mode that needs the private pack has no pack, or the pin file is missing. A push to the public repository always needs the pack. Exit 3.

**Fix:** The private pack or its pin file is missing; install them, then run check.ts --doctor.

Not allowlistable.

<a id="ps-pack-sha"></a>
### PS-PACK-SHA

The private pack's sha256 does not match its pin file. Exit 3.

**Fix:** The private pack does not match its pinned sha256; install the pinned pack, then run check.ts --doctor.

Not allowlistable.

<a id="ps-pack-invalid"></a>
### PS-PACK-INVALID

The private pack matches its pin but breaks the `harness-evals-admission-pack/1` schema, for example a prefilter value wider than 16 bits. Exit 3.

**Fix:** The private pack does not follow schema harness-evals-admission-pack/1; rebuild it with the pack builder.

Not allowlistable.

<a id="ps-gate-tree"></a>
### PS-GATE-TREE

The gate tree the private pack pins is not in this repository, does not hash to its id after extraction, or is not the copy that is running in hook mode. Exit 3.

**Fix:** The gate tree the pack pins is missing or does not hash to its id; fetch the public main and run check.ts --doctor again.

Not allowlistable.

<a id="ps-internal"></a>
### PS-INTERNAL

Any other error. The gate prints the operation, its tool version and the path of a trace file under the temp directory; the trace passes the same output boundary as everything else. Exit 3.

**Fix:** The gate failed inside; keep the trace file it names and report it.

Not allowlistable.

<a id="ps-id-config"></a>
### PS-ID-CONFIG

The doctor's identity probe made a throwaway commit with this checkout's identity and the identity gate refused it. A GitHub noreply address or the `identity.owner_accepted` address passes. The address is never printed.

**Fix:** Set this checkout's user.email to your GitHub noreply address or an identity.owner_accepted address, then run check.ts --doctor again.

Not allowlistable.

<a id="ps-hook-path"></a>
### PS-HOOK-PATH

`core.hooksPath` is set, so `.git/hooks` never runs. The doctor never changes it.

**Fix:** core.hooksPath is set, so .git/hooks never runs; unset it, then run check.ts --doctor again.

Not allowlistable.

<a id="ps-hook-chain"></a>
### PS-HOOK-CHAIN

A `pre-push` hook already exists and does not run `pre-push.local`.

**Fix:** An existing pre-push hook does not run pre-push.local; make it run pre-push.local with the same arguments and stdin, then run check.ts --doctor again.

Not allowlistable.

<a id="ps-canary"></a>
### PS-CANARY

The doctor pushed a synthetic key-shaped canary through the installed hook to a temp bare repository and the push was not refused.

**Fix:** The installed hook let a canary push through; run check.ts --doctor again and report it if it repeats.

Not allowlistable.

<a id="ps-hook"></a>
### PS-HOOK

The installed hook refused a push as `PS-HOOK-<exit>`: the pinned gate exited with that code (1 for findings, 2 usage, 3 infrastructure, 127 when bun is missing, 128 plus the signal number when it was killed). Read the findings printed above the refusal.

**Fix:** The pre-push hook refused the push (PS-HOOK-<exit>); read the findings above it. Pushing with --no-verify to a public remote is forbidden.

Not allowlistable.

<a id="ps-priv-unavailable"></a>
### PS-PRIV-UNAVAILABLE

The `private-admission` status of a pull request head, posted by the watcher: the private lane has posted no final verdict for 30 minutes. The description is exactly `PS-PRIV-UNAVAILABLE: private lane unavailable; maintainers re-run private-admission for this head`; it names no internal thread or command.

**Fix:** Nothing to change in the pull request. A maintainer re-runs the private lane for that head with the command in the private repository's `private/admission/README.md`; its verdict replaces the error.

Not allowlistable.

<a id="ps-hook-receipt"></a>
### PS-HOOK-RECEIPT

The pinned gate exited 0 but did not print a receipt naming every pushed ref, its local sha and the pinned gate tree.

**Fix:** The pinned gate exited 0 without a receipt for every pushed ref; run check.ts --doctor again and report it if it repeats.

Not allowlistable.

## Changelog

- 2026-11-11: `lib/reference.ts` holds the reference shingle code the private pack builder used to keep to itself: the 8-word tokenizer, the 20-shingle threshold, the reference file paths and the common-phrase drop. The export's new `reference-overlap` gate uses the same code, so both count alike. It holds no reference text.
- 2026-11-09: the identity gate accepts the Capy account address (`identity.owner_accepted` in `rules.json`) as author and committer, and the header scans no longer flag it on those two lines. It stays refused in trailers, file contents, path names, ref names and anywhere else in a commit. The doctor's identity probe accepts it too. Pushes use this only after the private pack pins the new gate tree.
- 2026-11-08: follow-up to the first version. Archive member names gitleaks flags are withheld everywhere; gzip header fields, every tar header field, pax and GNU records and bytes after the end are scanned; an allowlist entry binds to its lines; a base blob at a new path gets that path's rules; ref names go through gitleaks; the identity gate reads every trailer with an address; a push runs main's gate as `public-safety-push`; new sections on CI and the private lane (with PS-PRIV-UNAVAILABLE) and on the docs-only allowlist.
- 2026-11-08: first version: the admission gate, its rules, classes, private pack reader, hook and doctor, replacing the weekly export's checks in front of every public push.
