# Owner-identity task set

**Can an agent with a memory store tell which speaker is its owner?** Each task hands the agent chat logs, meeting transcripts, email or agent session logs, or puts it in a group chat, and checks where the facts in them end up.

- **Import tasks (11):** the owner asks the agent to import a folder of export files into the brain, then, in a new session an hour later, asks four questions.
- **Live tasks (4):** the owner and three others talk to the agent in a group channel and several of them ask it to remember things; then the owner asks four questions in a new session.
- **Session-capture tasks (2, Claude Code and Codex only):** the owner types two sessions to the agent, then asks it to start four worker agents. The agent runs a launcher that starts each worker as a headless `claude -p` or `codex exec` under it, with a brief that says "The user prefers ...". Two workers are marked as an agent's (`GBRAIN_SESSION_AGENT`), two are left to gbrain to detect. gbrain's capture hook saves every session; the briefs' facts are the orchestrator agent's, never the owner's. `capture.json` beside the task holds the briefs.
- Every planted fact carries one invented word (a token such as a made-up gym or venue name). The grader finds each token in the brain after the trial and checks whose page it landed on. `gold.json` in each task says whose fact it is.
- The hard cases: the owner under several names and addresses, forwarded mail, an assistant writing for the owner, swapped or anonymous speaker labels, a contact sharing the owner's first name, a contact saved as "Me", an AI assistant saying "I", and an agent's brief in the user's seat.
- Newer hard cases, rebuilt with the invented cast from misattribution shapes seen in a real owner's agent: a meeting transcript that puts the recording owner's name on another attendee's lines, the owner's own lines under "Participant 2" or "Speaker 2", an iMessage group export that labels every other member with the thread name, a notes page reporting what a friend told the owner, a news-alert digest paraphrasing a report about the owner, the owner's scheduling agent typing from the owner's account, and the owner's assistant pasting a third party's reply into a group chat.

**Everything here is invented.** The people, phone numbers (555-01xx), addresses (example.com, example.org, example.net) and tokens were made up by `world/owner-identity/generate.ts`.

## Layout

- `world/world.json`: the trial world. The owner, 13 other people, the live-task channels and every import file under `members/<owner>/imports/<task>/`. The files are private to the owner; `bot_reads_files_of` names the owner, so the agent reads what the owner can read, as a personal agent does. The runner adds the agent itself. Each people page is also a public world file (`people/<slug>.md`), so the gbrain image build lists it.
- `world/people.json`, `world/owner-card.md`: the cast with every handle, and the card each harness gets about its owner.
- `world/coverage.json`: how many tasks carry each hard case, by source.
- `corpus/dev/people/`: one gbrain people page per person, plus a second page with the owner's name and nothing else.
- `dev/<task>/task.toml` and `gold.json`: the turns, and the planted facts with their speaker roles and the answer each question needs; a session-capture task also has `capture.json`, the worker briefs and how each worker is launched.

## Hard cases in this bank (tasks)

| Hard case | Tasks |
|---|---|
| `owner_quoted_by_other` | 3 |
| `owner_quotes_other` | 7 |
| `owner_aliases` | 2 |
| `forwarded_email` | 1 |
| `assistant_on_behalf` | 2 |
| `group_chat` | 5 |
| `swapped_or_anonymous_labels` | 2 |
| `similar_name_decoy` | 4 |
| `me_contact_decoy` | 1 |
| `assistant_model_says_I` | 2 |
| `agent_brief_in_user_seat` | 5 |
| `recorder_label_absorbs` | 3 |
| `owner_under_generic_label` | 2 |
| `group_thread_one_label` | 1 |
| `reported_speech_in_notes` | 2 |
| `press_paraphrase` | 2 |
| `agent_on_owner_account` | 3 |
| `assistant_relays_thread` | 2 |
| `control` | 12 |

## Regenerate

```
bun world/owner-identity/generate.ts --seed owner-identity-dev-v1 --split dev --tasks 15 --out <dir>
bun world/owner-identity/check.ts
```
