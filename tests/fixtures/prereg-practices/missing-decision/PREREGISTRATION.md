# Fixture run: does a steps card raise review quality?

A fixture preregistration for tests/prereg-practices.test.ts. Nothing here ran.

## Eval loop

- Size: counted run
- Paid budget: $1,200
- Model judge: GPT-6 Astra (the runs use Claude Opus 5.5)

## Pilot

| Arm | Arm budget | Pilot cap |
|---|---:|---:|
| plain | $600 | $60 |
| card | $600 | $60 |

The pilot runs 4 tasks per arm and shows, on that arm's own outputs:

- **Part under test ran:** the card arm's transcripts open the card file; the plain arm's open no gstack file.
- **Judge passes R78:** the judge check below passes on the pilot's outputs for each arm.
- **Tasks can be supplied:** every pilot task image builds and starts at the planned rate.

## Judge check

| Arm | Labelled outputs | Kappa bar |
|---|---:|---:|
| plain | 20 | 0.6 |
| card | 20 | 0.6 |

## Interim look

- Look at: 32 of 64 units
- Stop bounds: stop for harm if the card arm trails by more than 15 points with the 95% range below 0; no stop for benefit.
