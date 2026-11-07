# Full merged trees: v04-cal-r1-2026-11, v04-transfer-2026-11, v04-cal-r2-2026-11, v04-cal-r3-2026-11, v04-cal-r4-2026-11

The committed results trees leave out `logs/`, harness state and `trial.json` (see each `results/.gitignore`). The amendment-2 clean-arm audit (`scripts/v04/clean-arm-audit.ts` at 9bd9467f) needs the agent traces under `logs/turns/`, so it read the full merged trees. Those trees are archived here for the results claim check.

**Harness-owned files inside: never published or exported; for the claim check only.** The trees hold harness state, including Hermes's `tirith` binary, and per-trial world tokens.

## Location

Private project-user Capy drive (harness-eval project, Garry Tan): `artifacts/v04-cal-full-trees/`. The drive syncs files up to 100 MiB, so the four larger tarballs are stored as parts of 94,371,840 bytes or less (`split -b 90M -d -a 2`):

- `v04-transfer-2026-11.full.tgz` (whole);
- `v04-cal-r1-2026-11.full.tgz.part-00` and `-01`;
- `v04-cal-r2-2026-11.full.tgz.part-00`, `-01` and `-02`;
- `v04-cal-r3-2026-11.full.tgz.part-00` and `-01`;
- `v04-cal-r4-2026-11.full.tgz.part-00` and `-01`;
- `SHA256SUMS` (the five whole tarballs) and `SHA256SUMS.parts` (the nine parts).

To restore: `sha256sum -c SHA256SUMS.parts`, then `cat <run>.full.tgz.part-* > <run>.full.tgz` for rounds 1 to 4, then `sha256sum -c SHA256SUMS`. Done on 2026-11-06 from the drive copies: all five parts OK, all three reassembled tarballs OK. Done again on 2026-11-07 after adding round 3: all seven parts OK, all four tarballs OK. Done again on 2026-11-07 after adding round 4: all nine parts OK, all five tarballs OK.

## Tarballs

Built with `tar --sort=name --mtime=@0 --owner=0 --group=0 -C <tree> -czf <run>.full.tgz .`. A second build of the transfer tarball, and of the round 3 and round 4 tarballs, gave the same sha256.

| Run | Tree (du -sh) | Tree bytes | Tarball | Tarball bytes | sha256 |
|---|---|---:|---|---:|---|
| v04-cal-r1-2026-11 | 646M | 651,541,351 | v04-cal-r1-2026-11.full.tgz | 164,030,074 | e062ee1051b718f03be3838061a9a59e8d697ae52162385b8828f90c07efe0b5 |
| v04-transfer-2026-11 | 189M | 191,051,830 | v04-transfer-2026-11.full.tgz | 50,890,339 | 7746d3713706caf9bf1ed446ef87dd2cf576abfc1aca61a99e270315a50427d6 |
| v04-cal-r2-2026-11 | 832M | 842,202,171 | v04-cal-r2-2026-11.full.tgz | 226,225,067 | d76f5bdbc7cc492636e816cdba8571cb4a9a865605eba42e530113bf85140e2e |
| v04-cal-r3-2026-11 | 469M | 469,908,206 | v04-cal-r3-2026-11.full.tgz | 104,968,906 | 3c67220dd45d23af0b4ffc5d770a5dd0742e9cb223421cd3e77056ad813b2c4b |
| v04-cal-r4-2026-11 | 465M | 470,271,655 | v04-cal-r4-2026-11.full.tgz | 128,138,790 | 130509dd22a1d266cd73f5a82521f7d06a4724e7146e419c1b968e6db33674fe |

`SHA256SUMS`:

```
e062ee1051b718f03be3838061a9a59e8d697ae52162385b8828f90c07efe0b5  v04-cal-r1-2026-11.full.tgz
d76f5bdbc7cc492636e816cdba8571cb4a9a865605eba42e530113bf85140e2e  v04-cal-r2-2026-11.full.tgz
3c67220dd45d23af0b4ffc5d770a5dd0742e9cb223421cd3e77056ad813b2c4b  v04-cal-r3-2026-11.full.tgz
130509dd22a1d266cd73f5a82521f7d06a4724e7146e419c1b968e6db33674fe  v04-cal-r4-2026-11.full.tgz
7746d3713706caf9bf1ed446ef87dd2cf576abfc1aca61a99e270315a50427d6  v04-transfer-2026-11.full.tgz
```

`SHA256SUMS.parts`:

```
3576fe4969e5df108cce1fe06da9e63b6717070c97a5ce4c6a06e47b7b3aeb5b  v04-cal-r1-2026-11.full.tgz.part-00
7dd21b6f7c004e85d281529d87f3e50e26188273e7faaabc94137ab49e0dd20e  v04-cal-r1-2026-11.full.tgz.part-01
322438ff1a71b1d08b735c234c921dc90504bbf982f231b18f0e5d0c39bc1a2f  v04-cal-r2-2026-11.full.tgz.part-00
13c26440ea203f83cc7fb429f5d9d473cf7f307dedce3036b26b12e2a3bb78ad  v04-cal-r2-2026-11.full.tgz.part-01
3501e6df62d191948ace89261d000bbe0179beb042bf2b39564a641588bfa1ab  v04-cal-r2-2026-11.full.tgz.part-02
396cf8d02d358f62e3a8fd74aaf0a6740d7ac50ca6635197ae02b911f7aee778  v04-cal-r3-2026-11.full.tgz.part-00
0f98edc8acfdfb95f23ec2556d4bfd726c38e304c567632bc082c019ce4b0c9b  v04-cal-r3-2026-11.full.tgz.part-01
85c903c38eba23174d6028d3ebf71bf32e5d6864c74b5df9295fdd57b0a1f131  v04-cal-r4-2026-11.full.tgz.part-00
91d11dfaefe264553a5a4724a4b8fad11c5a1209b53ce373a0c38fadb8579c6a  v04-cal-r4-2026-11.full.tgz.part-01
```

Each tree's `trials.jsonl` is byte-identical to the committed one. Rounds 2, 3 and 4 keep `snapshot.json` uncompressed, as the audit read it; round 1 and the transfer check hold `snapshot.json.gz`. The round 3 and round 4 trees also hold their `clean-arm-audit.9bd9467f.json`.

## Key scan of the contents

Every file of each extracted tarball, `.gz` files decompressed:

- **Exact values of the five model and cloud keys on the archiving machine: 0 hits** in all five.
- **Key-shaped strings: hits** in round 1 (414 files), the transfer check (104), round 2 (417), round 3 (343) and round 4 (209), from two sources only:
  1. **World tokens.** The per-trial fake Slack bot tokens, `xoxb-<trial id>-<random>` (`world/services/server.ts`), in `trial.json` (`WORLD_MCP_TOKEN`, `token`) and the harness config (`state/hermes/config.yaml` and its backups, `state/openclaw/openclaw.json` and `.bak`). Each authenticated only to its trial's local world server, which no longer exists.
  2. **Constant strings in Hermes's `tirith` binary** (`state/hermes/bin/tirith`, an ELF executable): one value each of the AKIA, gh*_, github_pat_, sk-ant-, sk-proj- and xox shapes, the same in every trial and absent from the repository. Probably detector test strings; unproven.

## GitHub release attempt (failed)

The first choice was a permanent draft release `v04-cal-full-trees`. The archiving machine's GitHub credential (a GitHub App user token) could create and delete releases but not read them or upload assets: `gh release upload` said "release not found", a GET by id gave 403 "Resource not accessible by integration", and asset uploads gave HTTP 400. No asset reached GitHub. A second draft (id 436899741) was deleted. **An orphan empty draft, `untagged-d27d5a36e991677607ff`, is still on the repository and needs an admin to delete it.**
