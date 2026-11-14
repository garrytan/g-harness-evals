# pytorch-model-cli: blind trace read

## 1. What made the task hard

The engineering is small: no torch or numpy in the image, so the agent has to read model.pth (a torch zip) by hand, dump six float32 tensors to JSON, and write a C/C++ MLP (784-16-16-10) with the bundled lodepng and cJSON. The real trap is input scaling. The instruction and model.py say nothing about normalisation, and the hidden test_cli_tool_output compares the tool against fixed "TRUE_PRED_CLASSES" for 50 MNIST test images. Those are the model's own outputs on plain ToTensor input ([0,1] pixels), including its mistakes (image 0 is expected to be "2"; in X-1's run the true-label accuracy of that scaling was 65.5%). An agent that "improves" the model by choosing the scaling that maximises label accuracy diverges on roughly a quarter of images and fails. The single provided image.png predicts 2 under every scaling, so checking it cannot catch the trap. The limit is 900 s; honest work took 0.7 to 3.9 minutes of session time.

## 2. Tries

**X-1: FAIL, MODEL-WRONG-APPROACH** (borderline GRADER-REJECTED-CORRECT, since the spec never states the scaling)
- 1.0m: binary built; plain [0,1] input prints 2 for image.png.
- 1.3m to 2.2m: downloads the MNIST test set and grid-searches mean/std: "x/255 0.656 ... (x-0.5)/0.5 0.902"; full test set "mean 0.5 ... 0.9207".
- 2.6m: hard-codes "for (double &v : x) v = (v - 0.5) / 0.5;". Binary scores 92.4% on 1000 PNGs.
- Verifier: 5 of 6 tests pass; "FAILED test_cli_tool_output - Predictions do not match expected values".
- Time: about 3.0 min of session, all active; no command over about 20 s. Verified true-label accuracy and output format, never fidelity to the model's unscaled forward pass.

**X-2: FAIL, MODEL-WRONG-APPROACH** (same borderline note)
- 1.6m: inspects first-layer weights against init bounds to guess training preprocessing.
- 1.9m to 2.2m: downloads MNIST, grid-searches scaling.
- 2.7m: "plain pixel/255 scaling only reaches 66% on MNIST versus 92% with [-1, 1] normalization, so I'm switching the tool to that".
- 3.9m final message names the risk itself: "if whatever consumes this tool expects plain pixel/255 scaling, predictions on other images would differ in roughly a quarter of cases".
- Verifier: same single failure, test_cli_tool_output.
- Time: about 3.9 min, all active. Verified 92.07% on all 10,000 test PNGs and output format.

**Y-1: PASS**
- 0.2m: custom unpickler extracts weights.
- 0.6m to 0.7m: Python reference forward pass under both "/255" and "norm" scaling; both give 2 for image.png.
- 0.8m: keeps [0,1] scaling and says "Pixel scaling is a guess".
- Time: about 0.8 min, all active. Verified one image against an independent reference implementation and by viewing it.

**Y-2: PASS**
- 0.2m weights extracted; 0.5m binary prints 2 with "x[i] = img[i] / 255.0f".
- 0.6m: ASCII render of image.png confirms a 2. Final note: "If training also used the standard MNIST mean/std normalisation, predictions on other images could be off".
- Time: about 0.7 min, all active. Verified one image only.

## 3. X versus Y

Both X tries went further than asked: they downloaded MNIST, measured label accuracy, and replaced the model's plain forward pass with (x-0.5)/0.5 normalisation. Both Y tries kept the literal [0,1] input, checked only image.png, flagged the scaling as an assumption and stopped within a minute. X's extra effort is exactly what failed, because the grader checks agreement with the model's [0,1] predictions, not accuracy. **STRONG.**

## 4. Environment vs model

This measured the agents: no environment problems, and the outcome turned entirely on an interpretation choice that was consistent within each agent. The spec's silence on scaling is a real grader trap.
