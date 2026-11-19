# Owner-identity task set

**Can an agent with a memory store tell which speaker is its owner?** Each task hands the agent chat logs, meeting transcripts, email or agent session logs, or puts it in a group chat, and checks where the facts in them end up.

- **Import tasks (8):** the owner asks the agent to import a folder of export files into the brain, then, in a new session an hour later, asks four questions.
- **Live tasks (4):** the owner and three others talk to the agent in a group channel and several of them ask it to remember things; then the owner asks four questions in a new session.
- Every planted fact carries one invented word (a token such as a made-up gym or venue name). The grader finds each token in the brain after the trial and checks whose page it landed on. `gold.json` in each task says whose fact it is.
- The hard cases: the owner under several names and addresses, forwarded mail, an assistant writing for the owner, swapped or anonymous speaker labels, a contact sharing the owner's first name, a contact saved as "Me", an AI assistant saying "I", and an agent's brief in the user's seat.

**Everything here is invented.** The people, phone numbers (555-01xx), addresses (example.com, example.org, example.net) and tokens were made up by `world/owner-identity/generate.ts`.

## Layout

- `world/world.json`: the trial world. The owner, 13 other people, the live-task channels and every import file under `members/<owner>/imports/<task>/`. The files are private to the owner; `bot_reads_files_of` names the owner, so the agent reads what the owner can read, as a personal agent does. The runner adds the agent itself. Each people page is also a public world file (`people/<slug>.md`), so the gbrain image build lists it.
- `world/people.json`, `world/owner-card.md`: the cast with every handle, and the card each harness gets about its owner.
- `world/coverage.json`: how many tasks carry each hard case, by source.
- `corpus/dev/people/`: one gbrain people page per person, plus a second page with the owner's name and nothing else.
- `dev/<task>/task.toml` and `gold.json`: the turns, and the planted facts with their speaker roles and the answer each question needs.

## Hard cases in this bank (tasks)

| Hard case | Tasks |
|---|---|
| `owner_quoted_by_other` | 3 |
| `owner_quotes_other` | 7 |
| `owner_aliases` | 3 |
| `forwarded_email` | 2 |
| `assistant_on_behalf` | 2 |
| `group_chat` | 5 |
| `swapped_or_anonymous_labels` | 2 |
| `similar_name_decoy` | 2 |
| `me_contact_decoy` | 2 |
| `assistant_model_says_I` | 2 |
| `agent_brief_in_user_seat` | 2 |
| `control` | 6 |

## Regenerate

```
bun world/owner-identity/generate.ts --seed owner-identity-dev-v1 --split dev --tasks 12 --out <dir>
bun world/owner-identity/check.ts
```
