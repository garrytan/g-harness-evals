# Review sessions on the OpenClaw and Hermes overlays

This is the harness side of cells C3 (particle-1 in OpenClaw) and C4 (DeepSeek V4 Pro in Hermes) of the real-bug review eval (internal-task-a, plan `handoffs/internal-task-b/autoplan/plan-full.md` in the Harness Evals drive). One session is one PR-pass: one unit repo, one arm, one pass, one model.

**What we learned building it.** At gstack `4bee369d` (v1.99.3.0), gstack's `/review` on OpenClaw and Hermes has no Review Army and no adversarial subagent, so those two cells test gstack's single-agent review procedure. The particle-1 route meters end to end. The DeepSeek V4 Pro route does not exist in the metering proxy today, so C4 cannot run as planned until one is added.

## Files

- `told.ts`: the two told lines. The plain line is gstack-evals' #108 template (sha256 `16862a34...`) with the base filled in. The review line is R2's full-procedure prefix (`told-gstack-full-rr2.txt`, sha256 `c6334bf7...`), a space, then the same template.
- `rig-findings.ts`: the gstack-evals rig's findings parser, vendored byte for byte except two marked lines, so these cells parse findings by the same rule as C1 and C2.
- `harness-review.ts`: `told`, `session` (one PR-pass through `harnesses/run-trial.sh`) and `collect` (a directory of sessions to one arm in gstack-evals' noloss arm contract v1: `arm.json`, `findings/<unit>.jsonl`, `cost.tsv` from the proxy's usage log).
- `harness-smoke.ts`: the end-to-end smoke on a synthetic unit repo, through the real metering proxy on an internal docker network, with a fake upstream (keyless) or the provider (`--paid`).
- `tests/review-bugs/harness-review.test.ts`: keyless, docker-free checks of all of the above.

## How a session runs

1. The unit repo is checked: the base branch exists, HEAD is not the base, and the tree is clean.
2. The image must match the arm. The plain arm runs `harness-eval/<h>:gstack-none` (built with `GSTACK_COMMIT=none`: no gstack in the image, the wrapper logs `gstack: none`). The review arm runs an overlay built at a 40-character gstack commit. Both must have the start hook off.
3. The unit repo is copied into the trial's `/workspace` with its history. The told text is the `instruction.md` the counted adapters read there. `/instruction.md` goes into `.git/info/exclude`, so `git status` stays clean and `git diff <base>...HEAD` shows only the PR.
4. `run-trial.sh` runs with only PATH and HOME in its environment. With `--network`, the container joins an internal docker network whose gateway is the proxy's address. Checked: from both overlays on that network, `https://api.anthropic.com` and `1.1.1.1` time out.
5. The findings come from the main session's final text in the harness's own transcript (OpenClaw's session store, Hermes's `state.db`, read by `scripts/gsta-135/evidence.ts`). A run that did not exit 0, or a transcript that is not complete, is `incomplete`: a coverage gap, never zero findings.
6. The read audit counts evidence.ts's classified tool calls (gstack skill opens, gstack helper runs, any other gstack path). A plain session is `clean` only when all three are zero and the wrapper logged `gstack: none`.

```sh
bun scripts/review-bugs/harness-review.ts told --arm review --harness hermes --base main
bun scripts/review-bugs/harness-review.ts session --harness openclaw --arm plain --unit owner/repo#12@abc1234 \
  --unit-repo <dir> --base main --pass 1 --image harness-eval/openclaw:gstack-none --model particle-1 \
  --base-url http://host.docker.internal:<port>/<slot>/particle --api-key "$cred" --out <dir>/<slot> \
  --network <internal net> --host-gateway <gateway>
bun scripts/review-bugs/harness-review.ts collect --sessions <dir> --out <arm dir> --id plain-particle1-openclaw \
  --label "plain, particle-1 in OpenClaw" --suite <suite id> --usage-log <proxy usage.ndjson>
bun scripts/review-bugs/harness-smoke.ts --harness openclaw --route particle --out ~/.capy/work/smoke   # keyless
```

## Told lines per host

- **OpenClaw: R2's line unchanged.** gstack registers the skill as `review`. `openclaw agent exec` turns a leading `/review` into "Use the following explicitly referenced skills for this request. Read each skill's SKILL.md before acting: - review" ahead of the message (keyless probe, 2026-11-14).
- **Hermes: `/gstack-review` in place of `/review`, nothing else.** `gstack-review` is the only name gstack registers on Hermes. Hermes's one-shot entry never expands a slash command (only the interactive CLI does), so the model sees the line as text and has to open the skill with `skill_view` itself.

## Start hook: as shipped means off

gstack's start hook is "Off unless the user asks" (`lib/harness-start-hook.ts` at the pin). So on both hosts the as-shipped image is the default overlay, and the `-hook` images are not as shipped. `harness-review.ts` refuses any image whose `org.harness-eval.gstack.start_hook` label is not `off`.

## What ran (2026-11-14)

| Run | Harness | Route | Arms | Result | Spend |
|---|---|---|---|---|---|
| keyless smoke | OpenClaw | anthropic, fake upstream | plain, review | both exit 0, transcript complete, 1 finding each, plain read audit clean | $0 |
| keyless smoke | Hermes (oneshot) | anthropic, fake upstream | plain, review | both exit 0, transcript complete, 1 finding each, plain read audit clean | $0 |
| keyless route | OpenClaw | particle, fake upstream | plain, review | 1 call per session, metered, served model `particle-ai/particle-1` | $0 |
| paid route | OpenClaw | particle, real | plain | exit 0, 5 calls, 48,749 input tokens (38,656 of them cached), 1,446 output, 1 finding (the planted bug, confirmed with a throwaway test) | $0.00513 |

The fake upstream's script is the same for every session: one shell call (`git diff main...HEAD`), then a reply with one finding. The prices on keyless runs are the proxy's meter of the fake's token counts.

## Harness specifics found

- **gstack's /review has no readers on these hosts.** `hosts/openclaw.ts` and `hosts/hermes.ts` suppress `CROSS_MODEL_RESOLVERS` (`hosts/define-host.ts`), which includes `REVIEW_ARMY` and `ADVERSARIAL_STEP`. The rendered skill goes from Step 4 to Step 4.7, ships only `sections/preamble.md`, and never names `sessions_spawn` or `delegate_task`. So on C3 and C4 the exposure signals for specialists, the adversarial reader and returned reports are zero by construction. The expected-reader set for the gate must be computed per host. Codex (`hosts/codex.ts`) suppresses `REVIEW_ARMY` only.
- **Hermes one-shot discourages the skill.** Its system prompt says "Do not load general process skills (testing, debugging, review methodology) for work you already know how to do". It also caps delegation at 2 children per session (`delegation.oneshot_max_children`). Chat mode would expand `/gstack-review` into the skill, but the overlay's chat mode runs the Anthropic config only.
- **Hermes probes local model servers.** Each Hermes session sent 12 GET or POST requests the proxy refused at no cost (`/v1/models`, `/api/tags`, `/props`, `/version`, `/api/show`). They show up in `cost.tsv`'s `refused` column, and they are not model calls.
- **OpenClaw's exec turn offers no `sessions_spawn` directly.** The tools it offered were `apply_patch`, `edit`, `exec`, `ls`, `process`, `read`, `sessions_yield`, `tool_call`, `tool_describe`, `tool_search`, `view_image` and `write`. Hermes offered `delegate_task`.

## C4: the DeepSeek V4 Pro route cannot be metered today

- **The proxy on main has no route for it.** Its providers are anthropic, openai, voyage and particle. `POST /<slot>/openrouter/...` and `/<slot>/deepseek/...` both answer "no provider route" (keyless probe on main `3b4b226c`).
- **The only OpenRouter route is on internal-task's draft #378** (branch `harn57/prereg`, `33cbc002`). It is allowlisted to `deepseek/deepseek-v4.1-flash-1017` only and pinned to DeepSeek's own endpoint. It refuses `deepseek/deepseek-v4-pro` with HE-PROXY-008 (keyless probe).
- **OpenRouter has no DeepSeek-run endpoint for V4 Pro.** `openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints` (read 2026-11-14) names the model "DeepSeek V4 Pro 0423" and lists only third-party hosts (Baidu, StreamLake, DeepInfra, Azure and others, fp4 and fp8). DeepSeek's own API serves `deepseek-v4-pro` as DeepSeek-V4-Pro-0813 (api-docs.deepseek.com pricing page). So pinning OpenRouter to DeepSeek, as #378 does for Flash, is impossible for V4 Pro, and the OpenRouter model may be an older snapshot.
- **The price table already has `deepseek:deepseek-v4-pro`** ($1.32 input and $3.96 output per million at peak). The proxy has no deepseek provider, and no DeepSeek API key is configured on this machine.

No paid DeepSeek call was made.

## Changelog

### 2026-11-14: first version

Added the told lines, the vendored parser, the session and collect commands, the smoke and their tests. Why: cells C3 and C4 of the real-bug review eval need review sessions on the OpenClaw and Hermes overlays that write the same arm contract as the gstack-evals rig.
