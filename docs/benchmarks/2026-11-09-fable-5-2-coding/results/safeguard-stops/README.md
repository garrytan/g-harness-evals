# Safety-filter stops on the FEAL tasks

**Fable 5.2's provider safety filter stopped three of its FEAL cryptanalysis attempts in this run.** The report says so; this folder is the source you can check.

**The refusal counter does not list these three attempts.** The run's records label two of them a harness error and the third an ordinary fail, so the report's "no refusals" line keeps them in and its "no FEAL" line drops the two tasks instead.

## What is here

- [safeguard-stops.json](safeguard-stops.json): one entry per stopped attempt, with the trial id, the transcript file, its sha256, and the line number and text of each line that shows the stop.
- Three Claude Code transcripts, one per attempt:
  - [fable52-r1h2-feal-differential-a1.claude-code.txt](fable52-r1h2-feal-differential-a1.claude-code.txt): trial `fable52-r1h2/feal-differential-cryptanalysis/a1`
  - [fable52-r2h2-feal-differential-a1.claude-code.txt](fable52-r2h2-feal-differential-a1.claude-code.txt): trial `fable52-r2h2/feal-differential-cryptanalysis/a1`
  - [fable52-r1h2-feal-linear-a1.claude-code.txt](fable52-r1h2-feal-linear-a1.claude-code.txt): trial `fable52-r1h2/feal-linear-cryptanalysis/a1`

## Where they come from

- Each file is the `harbor/agent/claude-code.txt` that Claude Code wrote inside the trial's directory (`trials/<cell>/<task>/a1/`) during the counted run.
- The run committed its trial records ([../merged/trials.jsonl](../merged/trials.jsonl)) but not these per-trial transcripts.
- The files are copied unchanged: each sha256 in the JSON matches the committed file. They were scanned for secrets before commit.

## How the lines show the stop

- `safeguards stopped the response above · continuing once with that noted`: Claude Code's notice that the provider's safety classifier withheld the model's reply. Claude Code then tells the model its reply was stopped and lets it go on once. All three transcripts have this line.
- `claude-fable-5-2's safeguards flagged this message`: the message Claude Code shows when the provider then refuses the request. Both feal-differential transcripts have it on their last two lines, and the line just before carries `"api_refusal_category":"cyber"`. Both runs ended there with `stop_reason` `refusal`.
- The feal-linear attempt went on after its one stop, then said it could not complete the task because a safety classifier had stopped it, and ended its turn (`stop_reason` `end_turn`). The grader scored it a fail.

## Why the refusal counter missed them

- `scripts/frontier-harbor/refusals.ts` lists a trial when its Harbor `exception.txt` or a file under its `agent/` folder contains a known marker. For Claude Code the marker is `AgentSafetyRefusalError`.
- Harbor recorded both feal-differential stops as `termination: harness_error` with `frontier.exception` `UnknownApiError` in [../merged/trials.jsonl](../merged/trials.jsonl). It recorded the feal-linear attempt as `completed` with grade `fail`.
- None of the three transcripts contains any of the counter's marker strings. So none of these trials is in [../analysis-full-norefusal/refusals.json](../analysis-full-norefusal/refusals.json), which lists only the bio-filter stops for Fable 5.2.
