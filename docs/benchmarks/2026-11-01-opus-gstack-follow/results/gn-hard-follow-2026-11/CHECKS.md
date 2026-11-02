# gn-hard-follow-2026-11: $0 checks (2026-11-02 UTC, before any paid trial)

One keyless Ubicloud check VM (<vm name>, standard-16, 37 min, list $0.31, destroyed; list --mine empty).
Checkout: 6d095a2fd + pin.json agent sha + run-shard.sh harbor-datasets upload line (uncommitted at check time). Laneb root ~/.capy/work/gstack-laneb-hard.

1. git fsck --full on harbor-datasets at 86723674f04e (blob:none partial clone, 10 tasks checked out): exit 0, clean. Also clean on the Capy copy.
2. Materialize swebv, 10 ids, digests resolved: tree 40f5b654d47a..., per-task image digests in check/mat/tasks.json.
3. Oracle through Harbor (materialized tasks, separate verifier, --network public for this check only): 10/10 reward 1.0, no exceptions.
4. No-op (Harbor nop agent): 10/10 reward 0.0, no exceptions. So all 8 primaries pass; no reserve needed.
5. Dry run (fake upstream, django__django-15732, cells none + gstack, allowlist):
   - System prompt captured on every request: 6,338 chars, contains "When the user types `/<skill-name>`, invoke it via Skill." (dry-fixed-system-prompt.txt).
   - Base-diff: scripted agent edits a .py file and runs git commit (dirty=0 after). Combined agent (57cb86d8): model.patch 349 bytes. Preset-only agent (54fb5462): model.patch 0 bytes.
   - FAIL: the gstack (invoked) trial is infra_error with the combined agent: "laneb agent: task django has no skill in the skill map, but this arm is invoked". laneb_agent.py:214 derives task_id = session_id.split("__")[0]; Harbor f3a5a923's session_id is "<trial_name>__env" with trial_name "<task>__<7 chars>", and every SWE-bench id contains "__". So every gstack session on swebv fails before the model is called.
   - Candidate fix (not in the design): third hunk task_id = session_id.rsplit("__", 2)[0] (agent sha a0d99d66...). Dry run with it: both trials completed, gstack invoked, Skill tool called with investigate, body loaded (body_load_rate 1), model.patch 349 bytes on both arms. Native/tb2 ids have no "__", so their task_id is unchanged.

6. Local keyless parse check (2026-11-02, after internal-task's parent approved fix A): the agent's own task_id expression, read from the final laneb_agent.py (sha a0d99d66...), evaluated on session ids built the way Harbor f3a5a923 builds them (models/trial/config.py:588 trial name, trial/trial.py:1468 "<trial_name>__env"), under env -i. All 8 primary ids come back whole; the native id and the tb2 id give the same result as the old split. Script: parse-check.py.

```
swebv  sphinx-doc__sphinx-10435   session=sphinx-doc__sphinx-10435__JURCczc__env     new=sphinx-doc__sphinx-10435   old=sphinx-doc       OK
swebv  django__django-15732       session=django__django-15732__JJMGHwA__env         new=django__django-15732       old=django           OK
swebv  django__django-15554       session=django__django-15554__u0BuXgE__env         new=django__django-15554       old=django           OK
swebv  pylint-dev__pylint-6386    session=pylint-dev__pylint-6386__TvPZAE9__env      new=pylint-dev__pylint-6386    old=pylint-dev       OK
swebv  sympy__sympy-15599         session=sympy__sympy-15599__xKUKdR9__env           new=sympy__sympy-15599         old=sympy            OK
swebv  pytest-dev__pytest-5787    session=pytest-dev__pytest-5787__afXVOxb__env      new=pytest-dev__pytest-5787    old=pytest-dev       OK
swebv  sympy__sympy-13031         session=sympy__sympy-13031__63J44cm__env           new=sympy__sympy-13031         old=sympy            OK
swebv  sphinx-doc__sphinx-7985    session=sphinx-doc__sphinx-7985__k0PxsXJ__env      new=sphinx-doc__sphinx-7985    old=sphinx-doc       OK
native gn-dev-fix-01              session=gn-dev-fix-01__eK6XlF9__env                new=gn-dev-fix-01              old=gn-dev-fix-01    OK
tb2    db-wal-recovery            session=db-wal-recovery__yW0aHin__env              new=db-wal-recovery            old=db-wal-recovery  OK
parse check: PASS
```
