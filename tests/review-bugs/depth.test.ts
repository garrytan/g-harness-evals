import { describe, expect, test } from "bun:test";
import { ADVERSARIAL, armyReaders, hostCaps, parseReviewPlan, parseScope, reviewReaders, ARMY_MARKER, ADVERSARIAL_MARKER } from "../../scripts/review-bugs/depth.ts";

const scope = (diffLines: number, on: string[] = [], sm: "true" | "false" | "unknown" = "false") =>
  parseScope(["FRONTEND", "BACKEND", "MIGRATIONS", "API", "AUTH"].map((k) => "SCOPE_" + k + "=" + on.includes(k)).join("\n"), "SCOPE_STATE_MACHINE=" + sm, diffLines);

const claude = { army: true, adversarial: true };

describe("Step 4.5's selection at the pin", () => {
  test("a diff under 50 lines skips every specialist but State Machines", () => {
    expect(armyReaders(scope(40, ["BACKEND"]))).toEqual({ required: [], conditional: ["red-team"] });
    expect(armyReaders(scope(40, [], "unknown")).required).toEqual(["state-machines"]);
  });
  test("50 lines or more: testing and maintainability always, the rest by scope signal", () => {
    expect(armyReaders(scope(60)).required).toEqual(["testing", "maintainability"]);
    expect(armyReaders(scope(60, ["BACKEND"])).required).toEqual(["testing", "maintainability", "performance"]);
    expect(armyReaders(scope(60, ["AUTH"])).required).toEqual(["testing", "maintainability", "security"]);
    expect(armyReaders(scope(150, ["BACKEND"])).required).toEqual(["testing", "maintainability", "security", "performance", "simplification"]);
    expect(armyReaders(scope(60, ["FRONTEND", "MIGRATIONS", "API"], "true")).required).toEqual(["testing", "maintainability", "performance", "data-migration", "api-contract", "design", "state-machines"]);
  });
  test("the Red Team is required only above 200 lines, else conditional on a CRITICAL", () => {
    expect(armyReaders(scope(201)).required).toContain("red-team");
    expect(armyReaders(scope(201)).conditional).toEqual([]);
    expect(armyReaders(scope(200)).required).not.toContain("red-team");
    expect(armyReaders(scope(200)).conditional).toEqual(["red-team"]);
  });
  test("a host's render decides which readers apply", () => {
    expect(reviewReaders(scope(60), claude).required).toEqual([ADVERSARIAL, "maintainability", "testing"]);
    expect(reviewReaders(scope(60), { army: false, adversarial: true })).toEqual({ required: [ADVERSARIAL], conditional: [] });
    expect(reviewReaders(scope(60), { army: false, adversarial: false })).toEqual({ required: [], conditional: [] });
  });
  test("host capabilities come from the rendered text's markers", () => {
    expect(hostCaps("x " + ARMY_MARKER + " y " + ADVERSARIAL_MARKER)).toEqual(claude);
    expect(hostCaps("only " + ADVERSARIAL_MARKER)).toEqual({ army: false, adversarial: true });
    expect(hostCaps("neither")).toEqual({ army: false, adversarial: false });
  });
  test("a missing state-matrix line counts as unknown, as Step 4.5's fallback does", () => {
    expect(parseScope("SCOPE_BACKEND=true", "", 10).stateMachine).toBe("unknown");
  });
});

describe("gstack-review-plan's DISPATCH lines", () => {
  const full = [
    "REVIEW_DEPTH: full runtime_lines=50 rules=66e5174161eecc2c reasons=risk:security,runtime=50 codes=none",
    "DISPATCH: specialist batched effort=medium checklists=testing,security,state-machines",
    "DIFF_CMD: batched git diff <diff-base>",
    "DISPATCH: red-team red-team effort=full",
    "DISPATCH: adversarial-native adversarial effort=full",
    "DISPATCH: outside-voice outside-voice effort=host",
    "SKIP: maintainability, performance, simplification (lean ensemble: read only when forced)",
  ].join("\n");
  test("batched, red-team and adversarial-native are readers; the outside voice is not a subagent", () => {
    expect(parseReviewPlan(full)).toEqual({ depth: "full", readers: [ADVERSARIAL, "batched", "red-team"], gate: [ADVERSARIAL, "red-team", "security", "state-machines", "testing"], outside: true });
  });
  test("the ship-panel gate names each checklist a reader carries, and adversarial-native only when it carries none", () => {
    const merged = "REVIEW_DEPTH: standard x\nDISPATCH: adversarial-native merged effort=full checklists=api-contract,red-team\nDISPATCH: specialist batched effort=medium checklists=testing,maintainability\nDISPATCH: outside-voice outside-voice effort=host";
    expect(parseReviewPlan(merged)).toEqual({ depth: "standard", readers: [ADVERSARIAL, "batched"], gate: ["api-contract", "maintainability", "red-team", "testing"], outside: true });
  });
  test("a specialist line with one checklist is that checklist's reader", () => {
    expect(parseReviewPlan("REVIEW_DEPTH: light x\nDISPATCH: specialist testing effort=medium checklists=testing\nDISPATCH: targeted targeted effort=full").readers).toEqual(["targeted", "testing"]);
  });
  test("output without a REVIEW_DEPTH line is refused", () => {
    expect(() => parseReviewPlan("DISPATCH: red-team red-team")).toThrow("E_DEPTH_PLAN");
  });
});
