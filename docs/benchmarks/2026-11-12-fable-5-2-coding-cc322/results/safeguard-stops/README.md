# Safety-filter stops the refusal counter missed

**The provider's safety filter stopped 8 attempts in this run that the refusal counter does not list.** The report counts them; this folder is the source you can check.

- Fable 5.2: 3 (both feal-differential-cryptanalysis attempts, one feal-linear-cryptanalysis attempt).
- Fable 5.1: 3 (both write-compressor attempts, one schemelike-metacircular-eval attempt).
- Opus 5.5: 2 (both feal-linear-cryptanalysis attempts).

The counter does list 17 other attempts ([../analysis-full-norefusal/refusals.json](../analysis-full-norefusal/refusals.json)): 16 bio-filter stops on the DNA and protein tasks and 1 Fable 5.1 gcode-to-text refusal.

## What is here

- [safeguard-stops.json](safeguard-stops.json): one entry per stopped attempt, with the trial id, how the run recorded it, the refusal category if one was logged, the transcript file, its sha256, and the line number and text of each line that shows the stop.
- Seven of the eight Claude Code transcripts, one per attempt:
  - [fable52-r1h2-feal-differential-a1.claude-code.txt](fable52-r1h2-feal-differential-a1.claude-code.txt): trial `fable52-r1h2/feal-differential-cryptanalysis/a1`
  - [fable52-r2h2-feal-differential-a1.claude-code.txt](fable52-r2h2-feal-differential-a1.claude-code.txt): trial `fable52-r2h2/feal-differential-cryptanalysis/a1`
  - [fable52-r1h2-feal-linear-a1.claude-code.txt](fable52-r1h2-feal-linear-a1.claude-code.txt): trial `fable52-r1h2/feal-linear-cryptanalysis/a1`
  - [fable51-r1h1-write-compressor-a1.claude-code.txt](fable51-r1h1-write-compressor-a1.claude-code.txt): trial `fable51-r1h1/write-compressor/a1`
  - [fable51-r2h1-write-compressor-a1.claude-code.txt](fable51-r2h1-write-compressor-a1.claude-code.txt): trial `fable51-r2h1/write-compressor/a1`
  - [opus55-r1h2-feal-linear-a1.claude-code.txt](opus55-r1h2-feal-linear-a1.claude-code.txt): trial `opus55-r1h2/feal-linear-cryptanalysis/a1`
  - [opus55-r2h2-feal-linear-a1.claude-code.txt](opus55-r2h2-feal-linear-a1.claude-code.txt): trial `opus55-r2h2/feal-linear-cryptanalysis/a1`
- Not committed: the transcript of trial `fable51-r2h1/schemelike-metacircular-eval/a1`. It is 1.1 MB (the attempt ran to its time limit), and it holds a vendor name the public export keeps out of the tree. Its entry in the JSON gives the stop's line number and text and the sha256 of the run's copy.

## Where they come from

- Each file is the `harbor/agent/claude-code.txt` that Claude Code wrote inside the trial's directory (`trials/<cell>/<task>/a1/`) during the counted run.
- The run committed its trial records ([../merged/trials.jsonl](../merged/trials.jsonl)) but not the per-trial transcripts.
- The files are copied unchanged: each committed file's sha256 in the JSON matches it. They were scanned for secrets before commit.
- Found by reading every attempt's claude-code.txt for Claude Code's safety-filter lines (below) and keeping the attempts the counter does not list. The 2.1.312 run's folder of the same name did the same for its 3 Fable 5.2 FEAL stops.

## How the lines show the stop

- `<model>'s safeguards stopped the response above · continuing once with that noted`: Claude Code's notice that the provider's safety classifier withheld the model's reply. Claude Code then tells the model its reply was stopped and lets it go on once. All 8 transcripts have this line once.
- Three attempts then ended in a refusal: a `stop_details` entry of type `refusal` with category `cyber`, and `stop_reason` `refusal`. These are both Fable 5.1 write-compressor attempts, refused at the first reply, and the Fable 5.2 feal-differential attempt of r2h2. The run recorded them as `termination: harness_error` with `frontier.exception` `UnknownApiError`.
- The other five went on after the one stop, ended their turn (`stop_reason` `end_turn`) and logged no category. Four were graded fail (both Opus feal-linear attempts and the Fable 5.2 feal-differential and feal-linear attempts of r1h2). Fable 5.1's schemelike-metacircular-eval attempt ran to its time limit and was graded pass.

## Why the refusal counter missed them

- `scripts/frontier-harbor/refusals.ts` lists a trial when its Harbor `exception.txt` or a file under its `agent/` folder contains a known marker. For Claude Code the marker is `AgentSafetyRefusalError`.
- None of the 8 trials has that marker: Harbor recorded the three cyber refusals as an `UnknownApiError`, and the other five ended normally.
