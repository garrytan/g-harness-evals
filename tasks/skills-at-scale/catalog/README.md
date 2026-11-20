# Skills-at-scale catalog ladder

Four nested skill catalogs for the skills-at-scale eval (plan decisions B and F): 100 ⊂ 351 ⊂ 700 ⊂ 1,500 skills. Each bigger catalog holds every skill of the smaller one, so the same requests run at every size and only the haystack grows.

- **351:** the skill-resolver eval's catalog, unchanged (`scripts/skill-resolver/packs.json`, hash `b6d67f1f...`).
- **700:** the 351 plus skills from vendor-maintained repositories (AWS, Hugging Face, Sentry, Expo, Cloudflare, Stripe, OpenAI, Anthropic, Google, Microsoft, .NET, Stitch, Supabase, Callstack).
- **1,500:** the 700 plus the remaining vendor skills and community repositories (awesome-copilot, alirezarezvani, wshobson, K-Dense, superpowers, antfu, Jeffallan, daymade).
- **100:** the 100 target skills only, with no distractors. They are drawn from the 351, stratified by source pack, and spread over 100 equal slices of the 1,500 names in name order.

Every added pack is pinned by commit in `scripts/skills-at-scale/packs-ladder.json`. The skill bodies are not committed; the builder rebuilds them byte for byte.

## Files

Three files are committed here. Two more, `manifest.json` and `safety-scan.json`, are too big to commit (about 1.6 MB together), so the builder writes them to `<snapshot>/records/` and `hashes.json` pins their sha256.

- `hashes.json`: the catalog hash and size of each rung, how many skills each pack puts in each rung, and the sha256 of the two files that are not committed.
- `manifest.json` (not committed): every skill's name, pack, source path, licence and where the licence came from, SKILL.md sha256, folder sha256, the rungs it is in, whether it was renamed, and the files left out of it. Also every pack's pin and licence notices, and every skill that was dropped, with the reason.
- `targets.json`: the 100 targets, each with its 1-based position in every rung, in code-point name order (what a byte-wise sort of folder names gives) and in the `en` locale order the catalog hash uses, plus the 20 pins and both seeds.
- `near-duplicates.json`: pairs of skills whose name plus description have a TF-IDF cosine of at least 0.5, for the labellers. Near-duplicates are kept on purpose: real catalogs have them.
- `safety-scan.json` (not committed): the files left out of added skills because they are scripts or binaries, every line in an added skill that fetches or runs something (curl, wget, pip, npx, base64, eval and similar), and the leak scans over the whole snapshot.

## Rebuild

```
bun scripts/skills-at-scale/fetch-packs.ts --dest <src>
bun scripts/skills-at-scale/build-ladder.ts --src <src> --out <snapshot> --gitleaks --check
bun scripts/skills-at-scale/build-ladder.ts --materialize 700 --out <snapshot> --dest <dir>
```

`fetch-packs.ts` needs git access to `yc-software/qm`, which is private. `--check` rebuilds and fails unless every file here comes out byte-identical, so the two files that are not committed must match the sha256 values in `hashes.json`; `--gitleaks` is needed because the committed scan includes gitleaks' findings. `--materialize` writes one rung as `<dir>/skills/<name>/` and prints its catalog hash, which `scripts/skill-resolver/shard-kit.ts` checks the same way.

The snapshot also carries `licences/<pack>/` (every pack's licence and notice files), `LICENCES.md` (skills whose licence comes from their own folder or frontmatter), `MODIFICATIONS.md` (every renamed or trimmed file), and a `MODIFICATIONS.md` inside each changed added skill, as Apache-2.0 section 4(b) asks.

## What drops

A skill from an added pack drops when its licence is not MIT, Apache-2.0, BSD or CC-BY-4.0 (GPL, non-commercial, PolyForm, share-alike, proprietary and unrecognised licences all drop), when its body is under 400 characters, when its SKILL.md letters are mostly non-Latin (daymade: over 2%), when its name is not a plain folder name, when it is another language's copy of the same Azure SDK skill, or when its pack is over its cap (Google 80, Microsoft 60, .NET 40). Anthropic's document skills (docx, pdf, pptx, xlsx) are left out at the plan gate.
