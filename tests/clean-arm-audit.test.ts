import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { audit } from "../scripts/prompt-archaeology/clean-arm-audit";

function trial(root: string, cell: string, task: string, file: string, body: string) {
  const d = join(root, "trials", cell, task, "r1", "logs");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, file), body);
}

describe("clean-arm audit", () => {
  test("counts a trial that read a gstack skill or the Capy drive, and passes config comments that only name gbrain", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-arm-"));
    trial(root, "cc-full", "t1", "turn-0001.claude.jsonl", '{"tool":"Read","path":"<private drive>/skills/gstack/SKILL.md"}');
    trial(root, "cc-full", "t2", "turn-0001.claude.jsonl", '{"tool":"Read","path":"/workspace/notes.md"}');
    trial(root, "cx-min", "t1", "config.toml", "# on a gbrain cell, [mcp_servers.gbrain]");
    trial(root, "cx-min", "t2", "turn.jsonl", "cat ~/.local/share/gstack/ship/SKILL.md");
    const cells = audit(root);
    expect(cells.map((c) => [c.cell, c.trials, c.contaminated])).toEqual([["cc-full", 2, 1], ["cx-min", 2, 1]]);
    expect(cells[0].hits.map((h) => h.pattern).sort()).toEqual(["capy-drive", "gstack-skill-file", "gstack-skills-dir"]);
    expect(cells[1].hits.map((h) => h.pattern)).toContain("gstack-install");
  });

  test("reads .gz files decompressed, lists links and binary files as skipped, and never follows a link loop", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-arm-skip-"));
    trial(root, "he-none", "t1", "turn.log", "nothing to see");
    const logs = join(root, "trials", "he-none", "t1", "r1", "logs");
    writeFileSync(join(logs, "agent.log.gz"), gzipSync("read ~/.capy/drive/user-garry-tan/skills/gstack/SKILL.md"));
    writeFileSync(join(logs, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    symlinkSync("..", join(logs, "loop"));
    const [cell] = audit(root);
    expect([cell.trials, cell.contaminated]).toEqual([1, 1]);
    expect(cell.hits.map((h) => h.file)).toContain(join("logs", "agent.log.gz"));
    expect(cell.skipped.map((s) => [s.file, s.reason]).sort()).toEqual([[join("logs", "blob.bin"), "binary"], [join("logs", "loop"), "symbolic link"]]);
  });

  test("throws when the results directory has no trials/", () => {
    expect(() => audit(mkdtempSync(join(tmpdir(), "clean-arm-empty-")))).toThrow("no trials/");
  });
});
