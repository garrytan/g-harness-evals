# world/brain: the qm-brain-native corpus (K8)

A seeded, keyless generator for one synthetic company's brain, the task audiences that may see each part of it, the dev and pilot tasks, and the leak scanner. The design and every frozen number are in [the preregistration](../../docs/benchmarks/2026-11-02-qm-brain-native/PREREGISTRATION.md).

- **corpus.ts**: seed string to canonical JSON (people, companies, meetings, timelines, facts, links, sources, page access). Also renders gbrain import pages and `links.tsv`.
- **names.ts**: syllable tables, the blocklist of real names, the seeded PRNG and the name check.
- **audience.ts**: the manifest for each audience, the gbrain bindings, the files export for the F arm, and `delivered()`, which recomputes what each arm receives from the rendered artifacts.
- **tasks.ts**: the task families, keys built only from manifest pages, and the public partitions. The held-out partition uses a sealed prompt bank and corpus B, and lives in custody.
- **scan.ts**: the canary and outbound-span scanner. `--sealed --log <file>` prints only a code and counts. Exit 0 means no hit, 1 a hit to audit, 2 bad input and 3 a crash with no verdict.
- **check.ts**: one command that regenerates corpus A twice, compares its digests with `seeds.json`, checks every arm's delivery, every key and every export, and runs the scanner self-test.

```
bun world/brain/check.ts                 # PASS line, or the HE-BRAIN code of the first problem
bun world/brain/check.ts --out <dir>     # new or empty dir; writes import/, links.tsv, corpus.json, tasks.json, exports/ only on PASS
bun test tests/brain-corpus.test.ts
```

A change to any file here needs a dated preregistration amendment in the same pull request. The digests cover the corpus, the tasks and the manifests, not the rendered export or the scanner, so a change that moves them also needs the new ones recorded in `seeds.json`. Error codes are in [docs/errors.md](../../docs/errors.md).
