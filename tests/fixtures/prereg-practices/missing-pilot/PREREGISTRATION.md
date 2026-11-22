# Fixture run: does a steps card raise review quality?

A fixture preregistration for tests/prereg-practices.test.ts. Nothing here ran.

## Eval loop

- Size: counted run
- Paid budget: $1,200
- Model judge: GPT-6 Astra (the runs use Claude Opus 5.5)

## What the result changes

- **Card arm ahead** (the gap is larger than the detectable difference): the card ships in the next gstack release.
- **Can't tell apart:** the card is a cut candidate and gets one "Why null?" pass before any cut.
- **Card arm behind:** the card is reverted and the regression goes to gstack's maintainers.

## Judge check

| Arm | Labelled outputs | Kappa bar |
|---|---:|---:|
| plain | 20 | 0.6 |
| card | 20 | 0.6 |

## Interim look

- Look at: 32 of 64 units
- Stop bounds: stop for harm if the card arm trails by more than 15 points with the 95% range below 0; no stop for benefit.

## Cost projection

- Spend stop: $1,200
- Pilot-priced projection: $980.40
- Projection receipt: plan-cost-receipt.json
