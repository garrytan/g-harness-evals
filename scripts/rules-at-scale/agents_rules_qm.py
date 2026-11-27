"""QM's Harbor class for the rules-at-scale eval: the QM runner's FrontierQm (scripts/frontier-harbor/agents.py), subclassed
and never edited, with agents_rules._Rules in front of it.

QM reads no rules file from the workspace. Its equivalent is the organization's SOUL, shown to the model under
"## Organization instructions". After FrontierQm has started QM and made its own admin calls, and after _Rules has placed
the arm's repository files (qm-repo's b8k AGENTS.md), RulesQm sets the arm's SOUL with one admin call
(rules_wiring.qm_soul_call): none sets nothing and QM's default SOUL stays, qm-repo sets an empty SOUL, every other arm sets
the manifest's qm-organization-instructions text. A text over 100,000 characters stops the trial (HE-RULES-011) and is
never cut; a reply other than 200, 201 or 204 stops it too (HE-RULES-012). The admin reply is not proof that the SOUL
reached the model; that is read from the captured first agent-loop request (rules_wiring.qm_soul_delivered).

The turn is a DM to QM core, not a command in the task container, so the launch checks and the watcher start run at the
start of run(), right before the turn. QM's version is FrontierQm's pin (harnesses/qm/pin.json, or QM_COMMIT), so
scripts/rules-at-scale/pin.json has no QM row. A failure while QM's containers are up stops them before it is raised;
one FrontierQm already stopped (its own start or setup failed, which empties _qm_names) is not stopped again, so its
qm-core.log keeps core's own output.

Job config: {"import_path": "agents_rules_qm:RulesQm", "model_name": "anthropic/claude-opus-5-5",
             "kwargs": {"broker_url": "http://127.0.0.1:8791", "cell": "...", "attempt": 1,
                        "rules": {"arm": "b8k", "files_dir": "<run>/rules/qm/b8k"}}}
"""

from __future__ import annotations

import agents as fa
import rules_wiring as rw
from agents_rules import _Rules
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class RulesQm(_Rules, fa.FrontierQm):
    HARNESS = "qm"

    async def setup(self, environment: BaseEnvironment) -> None:
        try:
            await super().setup(environment)
            if self._rules is not None:
                self._rules_record["pin"] = {"commit": self.QM_COMMIT}
                try:
                    await self._rules_soul()
                finally:
                    self._write_settings()
        except BaseException:
            await self._rules_stop_qm(environment)
            raise

    async def _rules_stop_qm(self, environment: BaseEnvironment) -> None:
        """Stops QM's containers while they are up, without letting a failed stop replace the error being raised."""
        if not self._qm_names:
            return
        try:
            await self._qm_stop(environment)
        except Exception as e:
            self._rules_record["qm_stop_error"] = str(e)[-300:]
            self._write_settings()

    async def _rules_soul(self) -> None:
        text = rw.qm_soul_text(self._rules["arm"], {"soul": self._rules_plan["soul"]})
        if text is None:
            self._rules_record["soul_call"] = None
            return
        call = rw.qm_soul_call(text)
        out = await self._qm_call("admin", call["method"], call["path"], body=call["body"], timeout=120)
        self._rules_record["soul_call"] = {"http": out.get("http"), "chars": rw.qm_chars(text)}
        if out.get("http") not in (200, 201, 204):
            raise rw.RulesRefused("HE-RULES-012", f"QM refused the SOUL admin call: http {out.get('http')}, exit {out.get('exit')}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if self._rules is not None and not self._rules_launched:
            try:
                await self._rules_at_launch(environment)
            except BaseException:
                await self._rules_stop_qm(environment)
                raise
        await super().run(instruction, environment, context)
