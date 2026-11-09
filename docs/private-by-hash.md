# Private-by-hash runs

A counted run normally commits its billing artifacts beside its results: the lease ledger (`results/*.sqlite`) and the proxy's usage log (`results/proxy-usage*.ndjson`). A **private-by-hash** run keeps those two private and publishes only their sha256 values. Everything else it publishes stays public: trials, grades, the report and the preregistration. Runs published before this class existed keep their billing artifacts public and are unchanged.

The code is [runner/prereg/private-by-hash.ts](../runner/prereg/private-by-hash.ts). The tests are [tests/private-by-hash.test.ts](../tests/private-by-hash.test.ts).

## Before the run: the preregistration pins

The experiment's entry in `preregistrations.json` (or `preregistrations.d/`) sets `"result_class": "private-by-hash"`. Its `PREREGISTRATION.md` holds exactly one fenced block tagged `json private-by-hash` that pins:

- `run_id`: the run identity. Every lease in the private ledger must be this id or start with it and a hyphen (one lease per shard), and every usage line's key must name it.
- `billing_protocol`: how spend is metered, in words. For example: metering proxy, one ledger lease per shard, reserve worst case then settle to usage.
- `cap_usd`: the cap. The verifier fails a ledger that commits more.
- `outputs`: each private artifact, with a `name`, a `schema` (`ledger-sqlite/1` or `proxy-usage-ndjson/1`) and a `location` under `private/` in the private repository.
- `verification`: the command that verifies the artifacts after the run.

The block pins no artifact hash. Those artifacts do not exist before the run, so any 64-character hex value in the block fails the check.

An example block, with made-up values:

~~~text
```json private-by-hash
{
  "run_id": "example-run-2026-12",
  "billing_protocol": "metering proxy, one ledger lease per shard, reserve worst case then settle to usage",
  "cap_usd": 50,
  "outputs": [
    { "name": "ledger", "schema": "ledger-sqlite/1", "location": "private/spend/runs/example-run-2026-12/ledger.sqlite" },
    { "name": "usage", "schema": "proxy-usage-ndjson/1", "location": "private/spend/runs/example-run-2026-12/proxy-usage.ndjson" }
  ],
  "verification": "bun runner/prereg/private-by-hash.ts verify --preregistration docs/benchmarks/<run>/PREREGISTRATION.md --root <private repository>"
}
```
~~~

## After the run: the results attestation

In the private repository, with the artifacts at their pinned locations, run:

```sh
bun runner/prereg/private-by-hash.ts attest --preregistration docs/benchmarks/<run>/PREREGISTRATION.md --root <private repository>
```

It checks each artifact against its schema and the run identity, then writes `results/private-by-hash.json` next to the preregistration. The file holds the run id, each output with its sha256 and row count, and the preregistration's path, sha256 and last commit. It carries no spend. Commit it with the results, after the preregistration. The preregistration itself is never edited to add hashes.

## Checks

- **CI** (`bun runner/prereg/prereg.ts`, with or without `--public`) checks every experiment of this class:
  - the block parses and pins no hash;
  - a run with trials has its attestation;
  - the attestation names the preregistration as it stands, and was added in a commit after the preregistration's last change;
  - its artifacts are exactly the pinned outputs, in order;
  - it carries no `*_usd` field;
  - no ledger or usage log of the run is committed anywhere in its run folder (results/, probe/, smoke-measurement/ or any other).

  An experiment registered without this class that has a `results/private-by-hash.json` fails too, so CI and the receipts manifest agree on which runs are of this class.
- **The private lane** runs `bun runner/prereg/private-by-hash.ts verify` where the artifacts are. The attestation must name exactly the pinned outputs, so an attestation that leaves out a ledger is refused. Each file must hash to its attested sha256, so a substituted ledger or log is refused even when it is well formed. Each must also match its schema, row count and the run identity, and the ledgers must stay within the cap.
- **The receipts manifest** ([receipts-manifest.json](receipts-manifest.json)) gives such a run `"result_class": "private-by-hash"` and lists the attested artifacts (name, schema, location, sha256) instead of ledger and usage-log rows.
- **The program's spend ledger** is computed in the private repository by `private/spend/budget-ledger.ts`, which reads each run's ledgers, including these private ones, and fails on any run with a ledger but no number. A private ledger must sit under `private/` and hash to its attested sha256. CI runs its tests (`bun test private/spend/`) in the private repository.

## Limits

- The public copy can check that the attestation is well formed and in order, but not that the hashes match the files. That check needs the private artifacts, so it runs only in the private lane.
- The report scripts that read a run's ledger or usage log (`summarize-run.ts`, `compare-run.ts`, `reconcile-provider.ts`) do not yet read private artifacts. A private-by-hash run reports its cost figures from the private lane.

## Changelog

### 2026-11-08: first version

The private-by-hash result class, its preregistration pins, its results attestation, the CI check in `prereg.ts`, the private verifier and the receipts manifest rows. Added so that a run can keep its billing artifacts private while its order and hashes stay public.
