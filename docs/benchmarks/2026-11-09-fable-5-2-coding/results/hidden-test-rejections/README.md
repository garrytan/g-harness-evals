# Hidden-test rejections: query-optimize and pytorch-model-cli

**Fable 5.2 finished query-optimize and pytorch-model-cli in both tries, and a hidden test rejected each try over a rule the task never stated.** This folder holds the test logs and transcripts behind that, so you can check it yourself.

- **query-optimize: correct work, rejected.** Both tries returned the same rows as the original query and passed the test's own correctness and speed checks. They failed only a 2,000-character size limit that the task never mentions.
- **pytorch-model-cli: arguably correct work, rejected. This case is weaker.** The test builds its input images with pixels scaled to 0 to 1 (pixel / 255), and the task never states a scaling. Fable's tool first matched pixel / 255, then Fable switched to [-1, 1] on purpose because it scored higher on the real labels, and said so.
- **The scores were kept as the tests gave them.** All four tries count as fails (reward 0) in the [report](../../report.md). Nothing here regrades a trial or changes a number.

## What is here

One folder per try. Each holds four files from that trial, copied from the counted run:

- `test-stdout.txt`: the hidden test's pytest output.
- `ctrf.json`: the same test results in CTRF, a JSON test-report format.
- `claude-code.txt`: Claude Code's transcript in stream-json, one event per line. A citation like `claude-code.txt:42` means line 42 of this file.
- `result.json`: Harbor's record of the trial (the task runner's own summary, with the reward).

| Folder | Trial | Harbor trial | Trial record |
|---|---|---|---|
| [fable52-r1h2-query-optimize-a1](fable52-r1h2-query-optimize-a1/) | `fable52-r1h2/query-optimize/a1` | `query-optimize__WZuDRhP` | [../merged/trials-full.jsonl](../merged/trials-full.jsonl) line 78 |
| [fable52-r2h2-query-optimize-a1](fable52-r2h2-query-optimize-a1/) | `fable52-r2h2/query-optimize/a1` | `query-optimize__g9pWqEG` | [../merged/trials-full.jsonl](../merged/trials-full.jsonl) line 156 |
| [fable52-r1h1-pytorch-model-cli-a1](fable52-r1h1-pytorch-model-cli-a1/) | `fable52-r1h1/pytorch-model-cli/a1` | `pytorch-model-cli__j5Ugqxt` | [../merged/trials-full.jsonl](../merged/trials-full.jsonl) line 48 |
| [fable52-r2h1-pytorch-model-cli-a1](fable52-r2h1-pytorch-model-cli-a1/) | `fable52-r2h1/pytorch-model-cli/a1` | `pytorch-model-cli__Aiz278Q` | [../merged/trials-full.jsonl](../merged/trials-full.jsonl) line 282 |

Each of those four trial records reads `termination` `completed`, `grade` `fail`, evidence `reward=0`. The run committed these records but not the per-trial test logs and transcripts.

## query-optimize: correct but rejected (both tries)

The task asks for a faster rewrite of an SQLite query that returns the same output, saved as one statement with no comments, without changing the database. Its instruction sets no length limit. The limit lives only in the hidden test.

### Try 1: fable52-r1h2-query-optimize-a1

- **Failing test:** `test_solution_is_small`.
  - `test-stdout.txt:48`: `MAX_CHARS = 2000`
  - `test-stdout.txt:53`: `E       AssertionError: Solution SQL is too large: 2154 characters (maximum allowed: 2000)`
  - `test-stdout.txt:56`: `/tests/test_outputs.py:244: AssertionError`
- **Passing tests** (`test-stdout.txt:66-70`): `test_compare_golden_vs_my_sql_query_correctness`, `test_check_for_db_modifications`, `test_compare_golden_vs_solution_runtime`, `test_outputs_match_exactly`, `test_solution_contains_single_sql_query`. Summary at `test-stdout.txt:72`: `1 failed, 5 passed in 530.70s (0:08:50)`.
- **What the transcript shows:**
  - The original query did not finish, so this try checked against a reference instead. `claude-code.txt:348`: "Your original did not finish in the 3.5 minutes I gave it before stopping it". The same message says the reference is the original query with its `ORDER BY … LIMIT 500` also applied inside the inner subquery.
  - `claude-code.txt:342` runs the final check, `cmp - /tmp/w/ref.txt && echo SAME_AS_REF`, and `claude-code.txt:343` prints `SAME_AS_REF`. This try has no `FINAL_SAME` line; `SAME_AS_REF` is its equivalent.
  - `claude-code.txt:348`: "That reference took 115 s, and `sol.sql` produces byte-identical output with the same column names." It also says the query "runs in about 0.13 s".
  - The hidden test's own exact-output check, `test_outputs_match_exactly`, passed (`test-stdout.txt:69`).

### Try 2: fable52-r2h2-query-optimize-a1

- **Failing test:** `test_solution_is_small`.
  - `test-stdout.txt:48`: `MAX_CHARS = 2000`
  - `test-stdout.txt:53`: `E       AssertionError: Solution SQL is too large: 2295 characters (maximum allowed: 2000)`
  - `test-stdout.txt:56`: `/tests/test_outputs.py:244: AssertionError`
- **Passing tests** (`test-stdout.txt:66-70`): the same five as try 1. Summary at `test-stdout.txt:72`: `1 failed, 5 passed in 517.04s (0:08:37)`.
- **What the transcript shows:**
  - `claude-code.txt:8` saves the original query's output: `sqlite3 -readonly oewn.sqlite < my-sql-query.sql > /tmp/orig.txt`.
  - `claude-code.txt:343` runs the final check: `sqlite3 -readonly /app/oewn.sqlite < /app/sol.sql | cmp - /tmp/orig.txt && echo FINAL_SAME`.
  - `claude-code.txt:346` prints `sol.sql: 128ms` and `FINAL_SAME`, so the output matched the original byte for byte.

### Why this counts as correct but rejected

- Every stated requirement is met, and the test's own correctness, speed, single-statement and no-change checks confirm it.
- The one failure is a size limit the task never states.
- **Caveat:** the speedup relies on facts about this database that its schema doesn't declare. Fable checked and disclosed them (try 1, `claude-code.txt:348`: "The query relies on three things that hold in this database but are not declared in the schema"). Both tries include a fallback branch that keeps the output correct if the shortcut's assumption fails (try 2, `claude-code.txt:348`: "**Fallback for correctness.**").

## pytorch-model-cli: correct but rejected, weak (both tries)

The task asks for a command-line tool, `/app/cli_tool`, that runs the provided MNIST digit model on a PNG and prints only the predicted digit. It does not say how to scale the input pixels.

The hidden test makes its images with plain `transforms.ToTensor()`, which scales pixels to 0 to 1 (try 1 `test-stdout.txt:860`, try 2 `test-stdout.txt:859`). It then compares the tool's answers on 50 MNIST test images with a fixed list of expected digits. That list is not the true labels: MNIST test image 0 is a 7, and the test expects 2.

### Try 1: fable52-r1h1-pytorch-model-cli-a1

- **Failing test:** `test_cli_tool_output`.
  - `test-stdout.txt:891`: `E       AssertionError: Predictions do not match expected values`
  - `test-stdout.txt:894`: `/tests/test_outputs.py:144: AssertionError`
  - `test-stdout.txt:896-909`: 14 of the 50 images differ, starting with `Prediction for image 0 is 7, expected 2`.
- **Passing tests** (`test-stdout.txt:918-922`): `test_weights_file_exists`, `test_cli_tool_exists`, `test_prediction_file_exists`, `test_prediction_file_content`, `test_cli_tool_executable`. Summary at `test-stdout.txt:924`: `1 failed, 5 passed in 11.15s`.
- **What the transcript shows:**
  - `claude-code.txt:71`: accuracy on the real MNIST labels under candidate scalings, including `(x-0.5)/0.5            acc 0.9207` and `(x-0)/1                acc 0.6590`.
  - `claude-code.txt:77` replaces the tool's `x[i] = pixels[i] / 255.0f;` with `x[i] = (pixels[i] / 255.0f - 0.5f) / 0.5f;`, which maps pixels to [-1, 1].
  - `claude-code.txt:82`, the final message: "The input scaling is inferred rather than given." and "The tool therefore uses the [-1, 1] scaling."

### Try 2: fable52-r2h1-pytorch-model-cli-a1

- **Failing test:** `test_cli_tool_output`.
  - `test-stdout.txt:890`: `E       AssertionError: Predictions do not match expected values`
  - `test-stdout.txt:893`: `/tests/test_outputs.py:144: AssertionError`
  - `test-stdout.txt:895-908`: the same 14 images differ, starting with `Prediction for image 0 is 7, expected 2`.
- **Passing tests** (`test-stdout.txt:917-921`): the same five as try 1. Summary at `test-stdout.txt:923`: `1 failed, 5 passed in 12.13s`.
- **What the transcript shows:**
  - `claude-code.txt:42`: before any change, the tool agreed with a Python reference using pixel / 255 on every image it checked: `cli vs python(/255) agreement 300 / 300`. The same line shows accuracy on the real labels of `/255 0.656` against `(x-0.5)/0.5 0.902`.
  - `claude-code.txt:76` then switches on purpose. It replaces `x[i] = pixels[i] / 255.0;` with `x[i] = (pixels[i] / 255.0 - 0.5) / 0.5;` and adds the comment `// applied to [0, 1] pixels: 92.1% on the MNIST test set, versus 65.9% with plain /255.`
  - `claude-code.txt:84`, the final message: "**Input scaling:** the tool scales pixels to [-1, 1], which is my inference from testing, not something `model.py` states."

### Why this counts as correct but rejected, and why it is weak

- Everything the task states is met, and the one failing test needs a pixel scaling the task never states.
- But this is not a formatting nit. Fable knowingly moved away from the conventional default that its own tool first reproduced.
- A grader who reads "run inference on the model" as "reproduce the model's outputs under the default pipeline" would call this a miss.
- These records can't settle which scaling the model was trained with. Fable's higher accuracy points to [-1, 1]; the test's images use pixel / 255.

## What was redacted

- **`result.json`, all four copies:** the trial machine's home directory path is replaced with `[redacted]`, 4 times per file (in `trial_uri`, `task_id.path`, `config.task.path` and `config.trials_dir`). No other byte changed.
- **Nothing else.** The other 12 files are byte-identical to the trial's own files.
- **Checked and not present:** the per-trial dummy proxy token appears in none of the files. The one proxy address, `broker_url` `http://127.0.0.1:8791` in each `result.json`, is a local address with no token in it, so it was kept. No API keys, hostnames, email addresses or personal names were found.
- **Scans run on this folder, all with zero findings:** gitleaks 8.30.1 with its default rules, with `publication/gitleaks.toml` and with `scripts/public-safety/gitleaks.toml`; trufflehog 3.99.8 `filesystem --no-verification`; and grep for `sk-ant-`, `sk-`, `Bearer`, `ghp_`, `github_pat_`, `AKIA` and `BEGIN ... KEY`.

sha256 of each `result.json` before redaction:

| File | sha256 before redaction |
|---|---|
| fable52-r1h2-query-optimize-a1/result.json | `d9cd729a2b937a22391bd6bf0b2fdae7ac64383fa3f8ed10eae648049cd5cb63` |
| fable52-r2h2-query-optimize-a1/result.json | `a613bf43d0f455c917cb613fc2e5a76bdaa361dd4cee68eccd3c29fefb4a4b15` |
| fable52-r1h1-pytorch-model-cli-a1/result.json | `b7d669870a0da70b3dc5309ffbd1bd6354927156480587420af642857d749264` |
| fable52-r2h1-pytorch-model-cli-a1/result.json | `05abc6770da47deb34db17b25a7a5f958fa693316d1e09522e67c8d555a1b5e7` |

## sha256 of every file as committed

| File | sha256 |
|---|---|
| [fable52-r1h2-query-optimize-a1/test-stdout.txt](fable52-r1h2-query-optimize-a1/test-stdout.txt) | `0e684035b6a867f7afbd8ea17d1854393f01cdcc85e307de19b64b1fb8ebb41a` |
| [fable52-r1h2-query-optimize-a1/ctrf.json](fable52-r1h2-query-optimize-a1/ctrf.json) | `456509c8eb47a69bd3b9c6bc4e1d263a843d6c2e253089d66b2b2105f571959d` |
| [fable52-r1h2-query-optimize-a1/claude-code.txt](fable52-r1h2-query-optimize-a1/claude-code.txt) | `6dcecdf0f946aeb0bf23df638a7300e05c0fee1cec7b9572a0cf09395a139044` |
| [fable52-r1h2-query-optimize-a1/result.json](fable52-r1h2-query-optimize-a1/result.json) | `435fca1ea287676b5b1f6bd1a5989280a2cc785b4ec3c3a8f0ead6acd9b5b698` |
| [fable52-r2h2-query-optimize-a1/test-stdout.txt](fable52-r2h2-query-optimize-a1/test-stdout.txt) | `6079e14db7b47737473843d1dab8c488f5dd1267540991d42763e3a62ae93216` |
| [fable52-r2h2-query-optimize-a1/ctrf.json](fable52-r2h2-query-optimize-a1/ctrf.json) | `61d60dafd2cf124f96af63b658ffa008efe270e5b3795475ef3502bc01027373` |
| [fable52-r2h2-query-optimize-a1/claude-code.txt](fable52-r2h2-query-optimize-a1/claude-code.txt) | `a67f546d5f3dcf7e9096d561d1e2af9b7d4b3619a495cff08146296c78e3fc49` |
| [fable52-r2h2-query-optimize-a1/result.json](fable52-r2h2-query-optimize-a1/result.json) | `fe612b89af5d91fc7de3c78f688b8223db61d572f0e3c09966e0c49a60165e43` |
| [fable52-r1h1-pytorch-model-cli-a1/test-stdout.txt](fable52-r1h1-pytorch-model-cli-a1/test-stdout.txt) | `778984bae8e47742780bedd63eb4b0c745d9c783cb1c928c44d14d79839f85be` |
| [fable52-r1h1-pytorch-model-cli-a1/ctrf.json](fable52-r1h1-pytorch-model-cli-a1/ctrf.json) | `dbf8f91f66bd667ddc0cb8fedd43c24cf12af5c9c92a64d1612321125c79efe1` |
| [fable52-r1h1-pytorch-model-cli-a1/claude-code.txt](fable52-r1h1-pytorch-model-cli-a1/claude-code.txt) | `b2eea11b1f3b707a2b17fce55d2e5711bb9c52e31e8fd832e7051b7047b34cbf` |
| [fable52-r1h1-pytorch-model-cli-a1/result.json](fable52-r1h1-pytorch-model-cli-a1/result.json) | `7036e6609e7c2f170c252b48e96cac2674e45a22e347a2ed3ec45e1edb58c0c6` |
| [fable52-r2h1-pytorch-model-cli-a1/test-stdout.txt](fable52-r2h1-pytorch-model-cli-a1/test-stdout.txt) | `4be5a9b00f5ef9d58a9489f2223037510d1291cc95065a6c1396863713fc61e3` |
| [fable52-r2h1-pytorch-model-cli-a1/ctrf.json](fable52-r2h1-pytorch-model-cli-a1/ctrf.json) | `4e0436aafcf2be599228063a549af9b40c5f5c27dddb44f6f4599327b500ba01` |
| [fable52-r2h1-pytorch-model-cli-a1/claude-code.txt](fable52-r2h1-pytorch-model-cli-a1/claude-code.txt) | `f731a18fd3694d66b6d6aaaa82579222e1c43f7c1abd803010b250322fdb11ae` |
| [fable52-r2h1-pytorch-model-cli-a1/result.json](fable52-r2h1-pytorch-model-cli-a1/result.json) | `fe266974da94a3e294723d585886fff95020f24190f78e3582bc141367892c0a` |
