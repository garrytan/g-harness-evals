# Graded task set T (skill-resolver eval, task phase)

**Set T is 48 small tasks. Each one goes well only if the agent finds one public catalog skill and follows a step in its SKILL.md that a model would not guess.** A deterministic checker grades the files the agent leaves behind. No model grades anything.

It is the task set of Phase C in the internal-task plan: native skill loading against the GBrain resolver against no catalog, on every harness cell.

## What the two scores mean

- **Used it**: the skill-specific check bits all pass. They test the step only the skill tells you, done the skill's way: a section order, a file location, a file name pattern, a named field, a checklist.
- **Success**: every check passes, the used-it bits and the plain task bits (the file exists, it is about the right thing).

A task counts only if the reference solution passes, doing nothing fails, and an obvious attempt by a scripted fake that never saw the skill fails the used-it bits while passing every other check. So used-it is what separates following the skill from doing a reasonable job without it.

## Layout

```
tasks/skill-resolver/T/tasks/<id>/
  task.json   the task (below)
  start/      the starting files of the working directory
  oracle/     the reference solution's files, laid over start/
  obvious/    what the scripted no-skill fake writes, laid over start/
```

Ids are `t01` to `t48` plus a short slug about the situation, never the skill's name, since the id may show up in a trial's working directory or logs.

Markdown inside task files uses code spans, not relative links, for paths in the working directory: such links resolve only once `start/` and an attempt are laid together, and `scripts/check-links.py` walks the repository tree.

## task.json

| Field | Meaning |
|---|---|
| `id` | the directory name |
| `target` | `name` (catalog name), `pack` (gstack, openclaw, hermes or qm) and `skill_md_sha256` (the catalog manifest's sha256 of that SKILL.md) |
| `request` | the user message, verbatim. It never names the skill or quotes its description, and it names every output path the checks read |
| `skill_step` | one or two sentences on the step only the SKILL.md gives, for reviewers |
| `used_it` | ids of the checks that make up the used-it bit |
| `checks` | the checker, a list of declarative checks (below) |
| `overlap` | `name_hit`, `nd_jaccard` (request words against the name and description words), `body_coverage` (share of request words found in the body) and `bin` |

Overlap uses the same `overlap()` as set P (`scripts/skill-resolver/gen-set-p.ts`). The bins are none (0), low (up to 0.05), mid (up to 0.12) and high (above 0.12). Results are stratified by bin.

### Checks

Every check has an `id`, a `kind` and a `why`. A check in `used_it` also lists `markers`: the skill's own words for the step. The request must not contain any marker, so the request does not give the step away. Paths are relative to the working directory.

| Kind | Fields | Passes when |
|---|---|---|
| `exists` | `path`, or `glob` with `min`/`max` (default 1 to any) | the file exists and is not empty; for a glob, the count of non-empty matches is in range |
| `regex` | `path` or `glob`, `pattern`, `flags`, `min`/`max` (default 1 to any) | the number of matches in the file (for a glob, in some matching file) is in range |
| `order` | `path`, `patterns`, `flags` | each pattern matches after the previous one's match |
| `json` | `path`, `pointer` (RFC 6901), then `equals`, `pattern` or `min_items` | the file parses, the pointer resolves, and the value matches |
| `frontmatter` | `path`, `key`, `pattern` | the file opens with YAML frontmatter whose key matches |

## How to check it

```
bun scripts/skill-resolver/check-set-t.ts                       # keyless; prints SETT_OK n=48 hash=<set hash>
bun scripts/skill-resolver/check-set-t.ts --catalog <catalog>   # also checks sha256s, packs and overlap against the catalog
```

The catalog is built with `scripts/skill-resolver/build-catalog.ts` and must have catalog hash `b6d67f1f044fab694182a424719a40b13a6e63640d8e814c7fd7277d97123fb7`. The set hash is the sha256 of one line per file under `tasks/` (path, tab, sha256), sorted by path. `tests/skill-resolver-set-t.test.ts` runs the keyless check in CI.

Authors fill `target.name`, the request and the checks, then run `--catalog <catalog> --stamp <id>` to write the pack, the sha256 and the overlap.

## Pack spread

The 48 targets follow the catalog's pack sizes (351 skills: hermes 208, gstack 64, openclaw 49, qm 30): hermes 28, gstack 9, openclaw 7, qm 4. No two tasks share a target. Skills that need a network, credentials or a real service are left out.

## Licences

Every target skill is MIT-licensed. Most task files are written for this set. Some reference solutions copy or adapt files a skill tells the agent to use, as following it requires: t16's oracle holds setup-wizard-generator's bundled template library, and t12, t20, t26 and t33 reuse short passages or code from their skills. Those copies stay under their upstream licences, whose texts are in [LICENSES/](LICENSES/) (hermes-agent, gstack and openclaw).

## Changelog

### 2026-11-08: first version (internal-task)

The format, the checker and the set, for the task phase of the skill-resolver eval.
