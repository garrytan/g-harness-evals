# tasks/gbrain-install

The gbrain install trial (internal-task). It asks one question: can an agent install gbrain by itself, save a fact to it, and get the fact back in a new conversation? `runner/trial/install.ts` runs it, and `scripts/gbrain-install/` scores it ([README](../../scripts/gbrain-install/README.md)).

## The conversations

1. **Install (s1).** The agent gets the arm's first message and installs gbrain.
2. **Scripted reply (s1).** After each install turn, the adapter's probe checks for gbrain on PATH, a brain, and the harness wired to gbrain. While the probe fails, the agent gets `reply.text`, at most `reply.max` (3) times. The reply fires only on the probe state, never on what the agent said. If the probe still fails after the last reply, the trial logs HE-INSTALL-002 and moves on.
3. **Save (s1).** `save` asks the agent to remember a fact that holds a per-trial nonce.
4. **Recall (s2).** A new conversation asks `recall`.
5. **Hinted (s3).** Only after a missed recall, a third conversation asks `hinted`, which names gbrain. It is descriptive only and never counts toward the finish line.

## The arms

- **bare** ([arms/bare.md](arms/bare.md)): "install gbrain", then the version line.
- **paste** (`arms/paste-<version>.md`, one file per pinned release: [arms/paste-0.60.734.0.md](arms/paste-0.60.734.0.md) at v0.60.734.0, a278ddf4, for the 2026-11-17 run, and the earlier [arms/paste-0.60.722.0.md](arms/paste-0.60.722.0.md) at 0.60.722.0, b82c23a7): the paste block from gbrain's README at the pinned release, byte for byte: the body of the README's one ```` ```text ```` block. It points the agent at gbrain's INSTALL_FOR_AGENTS.md and asks for a remember and recall round trip. A cell names its file in `install.paste_file`, with its `paste_sha256`. The version line follows it.
- **The version line** (`version_line`). Both arms end with it, after a blank line, word for word, with the cell's `install.tag` in place of `{tag}`. Evals of gbrain run on its newest release at launch, and gbrain's docs install `#stable`, which can lag that release by days, so the line names the release. It is the same in both arms, so the comparison between them stays fair. How often an agent installs `#stable` anyway is scored (scripts/gbrain-install/README.md, "Release pin").

## The finish line

A trial is `recalled` when the recall reply holds the nonce, the recall turn made a gbrain call, and the brain holds the nonce. If the nonce is found anywhere outside the brain (the harness's own memory, a notes file), the trial is `harness-memory` instead. Otherwise it is `not-recalled` when the install probe passed at some point, and `not-installed` when it never did.

## The other fields

- `conversations`: which conversation each message goes to.
- `time_budget_s`: the time limit per turn.

The gbrain release is not pinned here. Each cell names it in `install.tag`, with the commit the tag names in `install.commit`, and the runner refuses the cell (HE-INSTALL-001) when the tag no longer names that commit. A new release is a new paste file and a new preregistration pin, with no runner or task change.
- `egress.json`: the hosts the run's egress proxy blocks.
