# World seed: Pemberline Systems from messy-company-v1

`world.json` is the simulated company every world service loads. It is imported, not authored: `import.ts`
reads a checkout of [messy-company-v1](https://github.com/garrytan/gbrain-evals/tree/main/eval/data/messy-company-v1)
(MIT, frozen 2026-10-14) and turns its 226 pages into Slack members, channels and history, a file share, a
calendar and mailboxes. Nothing in the dataset is modified; `MANIFEST.json` records the sha256 of every input
file read, the hash over all of them, and the hash of the `world.json` they produce. The import is
deterministic: the test in `tests/world-import.test.ts` reruns it against the checkout and expects the same
hashes.

```bash
git clone https://github.com/garrytan/gbrain-evals ~/.capy/work/harness-eval/gbrain-evals
bun world/seed/import.ts ~/.capy/work/harness-eval/gbrain-evals/eval/data/messy-company-v1
```

The world's "today" is 2026-10-14, as the corpus says. Pages span November 2024 to October 2026 and keep their
dates. Timestamps use the company time zone America/Chicago at a fixed offset of -05:00; daylight-saving
changes inside the span are not modelled, because the services run a frozen offset-based clock.

## Inputs

`plan/world.json` (people, teams, accounts, ownership stints), `plan/pages.json` (one brief per page: kind,
writer, cluster, split, accounts, visibility) and the 226 pages under `corpus/{dev,heldout}/`. The plan is
the generator's own record of who wrote each page, so the writer of a note or email is never guessed from
the text. Labels under `labels/` are not read; they stay available to graders.

## Mapping rules

**Members.** The 14 Pemberline employees become workspace members with their plan id, role and team. Slack
handle is `first.last` in lower case as the corpus exports use it (`priyanka.sundaram`, `june.osei-lark`);
email is first initial plus surname at `pemberline.com`, the pattern the corpus emails use
(`rcalloway@pemberline.com`). Moss, Ruth's AI assistant in the corpus, is kept as a member of kind `agent` so
its digests have an owner. Anyone else who authors a chat message becomes a guest user: the planned contact
Mateo Quiroga and vendor Odile Brandt, and Samir Patel, an on-call engineer the plan does not list. Guests
belong only to the channels they posted in. Ruth Calloway (CRO), Anselm Grieve (CFO), June Osei-Lark (deal
desk) and Moss are `org_wide`: they read every team's files. Ruth is the workspace admin.

**Teams and accounts.** The four plan teams (North, Central, Coastal, Strategic) with their leads and members.
The 16 accounts keep their plan ids and aliases; `owner` is the primary owner of record on 2026-10-14 from the
stints (null for the two accounts that are pooled or on rotation). Renamed accounts carry the new name and
the rename record.

**Channels.** One channel per distinct `#name` in a chat page title:

| Channel | Rule | Members |
|---|---|---|
| `#north-team`, `#central-team`, `#coastal-team`, `#strategic-pod` | team working channel from a "#<team>-team" or "#<pod>" page | the team, plus every corpus author in that channel (June appears in `#strategic-pod`) |
| `#north-random`, `#central-random`, `#coastal-random`, `#strategic-random` | social channel from a "#<team>-random" export | the team plus its corpus authors |
| `#inc-qfl-sev1`, `#inc-tansley-carrier-api`, `#inc-vtg-hartford` | incident room from a "#inc-..." page | the owning team plus the authors (including guests such as Samir Patel and Mateo Quiroga) |
| `#general` | added: a workspace-wide channel every Slack workspace has | every employee and Moss; no history |
| `#help-it-ops` | added: named in a corpus message ("pinging IT in `#help-it-ops`", `chats/central-team-banter`) | every employee and Moss; no history |

A page titled "DM: ..." becomes a direct message between its authors (two in the corpus). Channel ids are
stable hashes of the name so reruns do not renumber them.

**Messages.** Every chat line that starts with one of the six header styles the generator models used
(`**09:12 — Dana Okafor:**`, `**Name** [09:14 AM]`, `[14:06] pree:`, `**Name  07:02 AM**`, `Name  10:42 AM`,
`**Name**`) starts a message; the lines up to the next header are its text. Authors resolve by full name,
first name, handle or initial+surname; a header whose name resolves to nobody known and does not look like a
person's name is treated as text, which is how section headings such as `**Exported:** 4 Nov 2025` are kept
out. The Slack `ts` is the page's frontmatter date plus the message time in -05:00, with a global counter in
the fractional part. The four undated exports (`#north-random`, `#central-random`, `#coastal-random`,
`#strategic-random`) have no date in the corpus on purpose; their messages are placed on 2026-10-13 and
flagged `date_basis: "undated"`.

**Files.** Contracts, tickets, CRM notes, account profiles, weekly updates, Moss's digests and personal notes
become files in a share, each with the page's writer as `owner`, the cluster's team as `team`, and a
`visibility`:

| Page kind | Path | Visibility |
|---|---|---|
| contract (`record`), ticket, CRM note, account profile | `accounts/<account>/{contracts,tickets,crm,profile}/<page>.md` (first named account) | `team` |
| weekly update | `teams/<team>/updates/<page>.md` | `team` |
| Moss digest (`agent-note`) | `teams/<team>/digests/<page>.md` | `public` |
| personal note | `members/<writer>/notes/<page>.md` | `private` when the page says `visibility: private`, else `public` |

`private` is readable by the owner only; `team` by the owner, the team and org-wide roles; `public` by every
member. The five private pages in the corpus are the five private files, so the ownership facts the dataset
labels as private-only stay private-only here. File bodies are the pages verbatim, frontmatter included.

**Calendar.** Each meeting page is one event organized by its writer, on the frontmatter date (the two pages
whose body names a different meeting day keep that in `body_date`), at the time the page states or 10:00
when it states none, one hour long. Attendees are the employees named on the page's "Attendees" line
("me" is the writer); external names stay in `attendees_text`. The page body is the event's notes.

**Mail.** Each email page is one received message from its `From:` header (the page writer when the header is
missing) to its `To:`/`Cc:` parties; "North team" expands to the team, a salutation such as "Pree," or
"Team," fills in a missing `To:`. External parties keep their raw address. A member's inbox is every mail
that names them.

**Splits.** Every record carries `split`: `dev` (North and Central), `heldout` (Coastal and Strategic), or
`both` for members, `#general` and `#help-it-ops`. A service started with `--split dev` loads only `dev` and
`both` records, so held-out accounts, channels, files, events and mail are absent, not merely hidden.

## Counts

From `MANIFEST.json` (`inputs_sha256` `cb99c66a…c84753d`, `world_json_sha256` `38dad886…34b856d7`):

| Record | Count |
|---|---|
| members | 18: 14 employees, 1 agent (Moss), 3 guests |
| teams | 4 |
| accounts | 16 |
| channels | 13 (4 team, 4 random, 3 incident, `#general`, `#help-it-ops`) plus 2 DMs |
| messages | 122 (81 dev, 41 heldout) |
| files | 148: 41 contracts, 17 CRM notes, 16 profiles, 10 tickets, 30 updates, 20 digests, 14 notes (5 private) |
| calendar events | 20 (10 dev, 10 heldout) |
| mail | 42 (21 dev, 21 heldout) |

Chat, email and meeting pages are consumed into messages, mail and events; the remaining 148 pages are files.
226 pages plus the two plan files are the 228 inputs.
