# Third-party notices

**This repository carries some text and code from other projects. Each keeps its own licence.**

- Our own code is MIT ([LICENSE](LICENSE)). Our findings, docs and data are CC BY 4.0 ([LICENSES/CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt)).
- Neither licence covers the material below. Each section says what it is, the version we captured, its licence and copyright line, where its text sits here, and the licence text.
- Paths with `*` or `**` are glob patterns.

## Contents

- [OpenClaw](#openclaw)
- [Hermes Agent](#hermes-agent)
- [QM](#qm)
- [Pi](#pi)
- [Codex](#codex)
- [inflection, schedule and tabulate](#inflection-schedule-and-tabulate)
- [gbrain-evals and gbrain: statistics kit, proxy, ledger, price table](#gbrain-evals-and-gbrain-statistics-kit-proxy-ledger-price-table)
- [gbrain-evals: the synthetic world](#gbrain-evals-the-synthetic-world)
- [gstack-evals: pinned Lane B files](#gstack-evals-pinned-lane-b-files)
- [Credits: Terminal-Bench 2 and SWE-bench Verified](#credits-terminal-bench-2-and-swe-bench-verified)
- [Claude Code](#claude-code)

## OpenClaw

- **What:** an agent harness under test. We captured its system prompts, tool schemas and bundled-skill descriptions as sent to the model.
- **Version:** 2026.10.6, installed from npm ([harnesses/openclaw/pin.json](harnesses/openclaw/pin.json)).
- **Upstream:** https://github.com/openclaw/openclaw
- **Licence:** MIT.
- **Copyright:** Copyright (c) 2026 OpenClaw Foundation
- **Paths that carry its text:**
  - `docs/harness-anatomy/receipts/anatomy-capture-openclaw-*`
  - `docs/harness-anatomy/records/openclaw-*`
  - `tests/fixtures/anatomy/openclaw-2026.10.6-spike.ndjson.gz`
  - `tests/fixtures/gsta-135/gsta135-openclaw-*`
  - `harnesses/ablation/openclaw.anthropic-messages.layers.json`, `harnesses/ablation/openclaw.openai-responses.layers.json` (short anchor phrases only)
  - `harnesses/ablation/coding/items.json` (OpenClaw spans)

~~~text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## Hermes Agent

- **What:** an agent harness under test. We captured its default identity file (SOUL.md), system prompts and tool schemas.
- **Version:** v2026.9.24, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` ([harnesses/hermes/pin.json](harnesses/hermes/pin.json)).
- **Upstream:** https://github.com/NousResearch/hermes-agent
- **Licence:** MIT.
- **Copyright:** Copyright (c) 2025 Nous Research
- **Paths that carry its text:**
  - `**/SOUL.md` under `docs/benchmarks/2026-10-25-gbrain-installer/`, `docs/benchmarks/2026-10-25-gbrain-installer-hook/` and `docs/benchmarks/2026-10-29-v03-installer-dev/` (trial state: Hermes's SOUL.md, some with gbrain's block appended)
  - `docs/harness-anatomy/receipts/anatomy-capture-hermes-*`
  - `tests/fixtures/anatomy/hermes-chat-probe.ndjson.gz`, `tests/fixtures/anatomy/hermes-oneshot-probe.ndjson.gz`
  - `tests/fixtures/gsta-135/gsta135-hermes-*`
  - `harnesses/ablation/hermes.anthropic-messages.layers.json`, `harnesses/ablation/hermes.openai-responses.layers.json` (short anchor phrases only)
  - `harnesses/ablation/coding/items.json` (Hermes spans)

~~~text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## QM

- **What:** an agent harness under test. We captured its system prompts, its session-title prompt and its tool schemas.
- **Versions:** v0.1.15, commit `7417aa2a` (every published cell), main at `b6786d675f83d9a818c5d5335cc017ffea9ec7a7` (keyless captures only), and main at `90e4ced75dba0f711e9737e5bb2f2d718870fb0f` (the internal-task pilot amendment's pin) ([harnesses/qm/pin.json](harnesses/qm/pin.json)).
- **Upstream:** https://github.com/yc-software/qm
- **Licence:** MIT (the same text at both commits).
- **Copyright:** Copyright (c) 2026 QM contributors
- **Paths that carry its text:**
  - `docs/harness-anatomy/receipts/anatomy-capture-qm-*`
  - `docs/harness-anatomy/records/qm-*`
  - The `qm-claude` capture also holds Claude Agent SDK and Claude Code text; see [Claude Code](#claude-code).

~~~text
MIT License

Copyright (c) 2026 QM contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## Pi

- **What:** the agent engine inside QM. Its prompt and tool text is part of the qm-pi captures.
- **Version:** `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` 0.82.0, in the builds QM vendors at the commits above (pi-ai 0.82.0-qm.1 at `7417aa2a`, 0.82.0-qm.3 at `b6786d67`; pi-coding-agent 0.82.0-qm-security.6 at both).
- **Upstream:** https://github.com/earendil-works/pi
- **Licence:** MIT.
- **Copyright:** Copyright (c) 2025 Mario Zechner
- **Paths that carry its text:**
  - `docs/harness-anatomy/receipts/anatomy-capture-qm-pi-*`

~~~text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## Codex

- **What:** OpenAI's coding agent CLI, a harness under test. We captured its system prompt and tool schemas as sent to the model.
- **Version:** 0.165.0, installed from npm (`@openai/codex`, [harnesses/codex/pin.json](harnesses/codex/pin.json)). The LICENSE and NOTICE below are the same at the `rust-v0.165.0` tag and on main.
- **Upstream:** https://github.com/openai/codex
- **Licence:** Apache License 2.0, with a NOTICE file.
- **Copyright:** Copyright 2025 OpenAI (from Codex's NOTICE)
- **Changes:** we did not modify Codex. The files below hold request bodies Codex 0.165.0 sent to the model, captured at our proxy, and spans cut from them for the layer ablation. Some are stored compressed or split into blobs.
- **Paths that carry its text:**
  - `docs/harness-anatomy/receipts/anatomy-capture-codex-*`
  - `harnesses/ablation/codex.openai-responses.layers.json` (short anchor phrases only)
  - `harnesses/ablation/coding/items.json` (Codex spans)

### Codex NOTICE

~~~text
OpenAI Codex
Copyright 2025 OpenAI

This project includes code derived from [Ratatui](https://github.com/ratatui/ratatui), licensed under the MIT license.
Copyright (c) 2016-2022 Florian Dehau
Copyright (c) 2023-2025 The Ratatui Developers
~~~

### Apache License 2.0 (from Codex's LICENSE file)

~~~text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction,
    and distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by
    the copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all
    other entities that control, are controlled by, or are under common
    control with that entity. For the purposes of this definition,
    "control" means (i) the power, direct or indirect, to cause the
    direction or management of such entity, whether by contract or
    otherwise, or (ii) ownership of fifty percent (50%) or more of the
    outstanding shares, or (iii) beneficial ownership of such entity.

    "You" (or "Your") shall mean an individual or Legal Entity
    exercising permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation
    source, and configuration files.

    "Object" form shall mean any form resulting from mechanical
    transformation or translation of a Source form, including but
    not limited to compiled object code, generated documentation,
    and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or
    Object form, made available under the License, as indicated by a
    copyright notice that is included in or attached to the work
    (an example is provided in the Appendix below).

    "Derivative Works" shall mean any work, whether in Source or Object
    form, that is based on (or derived from) the Work and for which the
    editorial revisions, annotations, elaborations, or other modifications
    represent, as a whole, an original work of authorship. For the purposes
    of this License, Derivative Works shall not include works that remain
    separable from, or merely link (or bind by name) to the interfaces of,
    the Work and Derivative Works thereof.

    "Contribution" shall mean any work of authorship, including
    the original version of the Work and any modifications or additions
    to that Work or Derivative Works thereof, that is intentionally
    submitted to Licensor for inclusion in the Work by the copyright owner
    or by an individual or Legal Entity authorized to submit on behalf of
    the copyright owner. For the purposes of this definition, "submitted"
    means any form of electronic, verbal, or written communication sent
    to the Licensor or its representatives, including but not limited to
    communication on electronic mailing lists, source code control systems,
    and issue tracking systems that are managed by, or on behalf of, the
    Licensor for the purpose of discussing and improving the Work, but
    excluding communication that is conspicuously marked or otherwise
    designated in writing by the copyright owner as "Not a Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity
    on behalf of whom a Contribution has been received by Licensor and
    subsequently incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    copyright license to reproduce, prepare Derivative Works of,
    publicly display, publicly perform, sublicense, and distribute the
    Work and such Derivative Works in Source or Object form.

3.  Grant of Patent License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    (except as stated in this section) patent license to make, have made,
    use, offer to sell, sell, import, and otherwise transfer the Work,
    where such license applies only to those patent claims licensable
    by such Contributor that are necessarily infringed by their
    Contribution(s) alone or by combination of their Contribution(s)
    with the Work to which such Contribution(s) was submitted. If You
    institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work
    or a Contribution incorporated within the Work constitutes direct
    or contributory patent infringement, then any patent licenses
    granted to You under this License for that Work shall terminate
    as of the date such litigation is filed.

4.  Redistribution. You may reproduce and distribute copies of the
    Work or Derivative Works thereof in any medium, with or without
    modifications, and in Source or Object form, provided that You
    meet the following conditions:

    (a) You must give any other recipients of the Work or
    Derivative Works a copy of this License; and

    (b) You must cause any modified files to carry prominent notices
    stating that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works
    that You distribute, all copyright, patent, trademark, and
    attribution notices from the Source form of the Work,
    excluding those notices that do not pertain to any part of
    the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its
    distribution, then any Derivative Works that You distribute must
    include a readable copy of the attribution notices contained
    within such NOTICE file, excluding those notices that do not
    pertain to any part of the Derivative Works, in at least one
    of the following places: within a NOTICE text file distributed
    as part of the Derivative Works; within the Source form or
    documentation, if provided along with the Derivative Works; or,
    within a display generated by the Derivative Works, if and
    wherever such third-party notices normally appear. The contents
    of the NOTICE file are for informational purposes only and
    do not modify the License. You may add Your own attribution
    notices within Derivative Works that You distribute, alongside
    or as an addendum to the NOTICE text from the Work, provided
    that such additional attribution notices cannot be construed
    as modifying the License.

    You may add Your own copyright statement to Your modifications and
    may provide additional or different license terms and conditions
    for use, reproduction, or distribution of Your modifications, or
    for any such Derivative Works as a whole, provided Your use,
    reproduction, and distribution of the Work otherwise complies with
    the conditions stated in this License.

5.  Submission of Contributions. Unless You explicitly state otherwise,
    any Contribution intentionally submitted for inclusion in the Work
    by You to the Licensor shall be under the terms and conditions of
    this License, without any additional terms or conditions.
    Notwithstanding the above, nothing herein shall supersede or modify
    the terms of any separate license agreement you may have executed
    with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade
    names, trademarks, service marks, or product names of the Licensor,
    except as required for reasonable and customary use in describing the
    origin of the Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or
    agreed to in writing, Licensor provides the Work (and each
    Contributor provides its Contributions) on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
    implied, including, without limitation, any warranties or conditions
    of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
    PARTICULAR PURPOSE. You are solely responsible for determining the
    appropriateness of using or redistributing the Work and assume any
    risks associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory,
    whether in tort (including negligence), contract, or otherwise,
    unless required by applicable law (such as deliberate and grossly
    negligent acts) or agreed to in writing, shall any Contributor be
    liable to You for damages, including any direct, indirect, special,
    incidental, or consequential damages of any character arising as a
    result of this License or out of the use or inability to use the
    Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all
    other commercial damages or losses), even if such Contributor
    has been advised of the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing
    the Work or Derivative Works thereof, You may choose to offer,
    and charge a fee for, acceptance of support, warranty, indemnity,
    or other liability obligations and/or rights consistent with this
    License. However, in accepting such obligations, You may act only
    on Your own behalf and on Your sole responsibility, not on behalf
    of any other Contributor, and only if You agree to indemnify,
    defend, and hold each Contributor harmless for any liability
    incurred by, or claims asserted against, such Contributor by reason
    of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2025 OpenAI

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
~~~

## inflection, schedule and tabulate

- **What:** small MIT Python libraries. The gstack-native-v1 repository tasks copy their working trees and single files.
- **Versions:** inflection at `b00d4d348b32ef5823221b20ee4cbd1d2d924462`, schedule at `82a43db1b938d8fdf60103bd41f329e06c8d3651`, tabulate at `bf58e37e6b35e3cc9a0bd740f752abfd32b6e6f8` (each task's `task.toml`, `[source]`).
- **Licence:** MIT, each.
- **Copyright:**
  - inflection: Copyright (C) 2012-2020 Janne Vanhala
  - schedule: Copyright (c) 2013 Daniel Bader (http://dbader.org)
  - tabulate: Copyright (c) 2011-2020 Sergey Astanin and contributors
- **Paths that carry their text:** `tasks/repo/gstack-native-v1/` (inside `environment/work.tar`, `verifier/protected/`, `verifier/trees/` and `oracle/final/` of each task; see [its README](tasks/repo/gstack-native-v1/README.md)).
- **Licence texts:** [inflection](tasks/repo/gstack-native-v1/LICENSES/inflection.txt), [schedule](tasks/repo/gstack-native-v1/LICENSES/schedule.txt), [tabulate](tasks/repo/gstack-native-v1/LICENSES/tabulate.txt). Each `work.tar` also keeps the project's own LICENSE.

## gbrain-evals and gbrain: statistics kit, proxy, ledger, price table

- **What:** the statistics kit, the metering proxy, the budget ledger and the model price table were vendored from gbrain-evals and gbrain ([runner/README.md](runner/README.md), "Vendored pieces"; [runner/stats/README.md](runner/stats/README.md)).
- **Versions:** gbrain-evals v0.10.128 (`6999ebc9`); gbrain `src/core/model-pricing.ts`, `embedding-pricing.ts` and `model-id.ts`.
- **Upstreams:** https://github.com/garrytan/gbrain-evals and https://github.com/garrytan/gbrain
- **Licence:** MIT. Both repositories have the same LICENSE text, shown once below.
- **Copyright:** Copyright (c) 2026 Garry Tan
- **Paths:** `runner/stats/`, `runner/proxy/`, `runner/ledger/`, `runner/pricing/`
- **Changes:** listed in [runner/README.md](runner/README.md) (import paths, a reduced `sanitize.ts`, a `cached_tokens` usage field, the 1-hour cache-write multiplier, and later proxy changes in that page's change log).

~~~text
MIT License

Copyright (c) 2026 Garry Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## gbrain-evals: the synthetic world

- **What:** Pemberline, the made-up company every trial runs in, imported from the `messy-company-v1` dataset. Nothing in the dataset is modified ([world/seed/README.md](world/seed/README.md)).
- **Version:** `eval/data/messy-company-v1` in gbrain-evals, frozen 2026-10-14. [world/seed/MANIFEST.json](world/seed/MANIFEST.json) records the sha256 of every input file.
- **Upstream:** https://github.com/garrytan/gbrain-evals/tree/main/eval/data/messy-company-v1
- **Licence:** MIT, Copyright (c) 2026 Garry Tan (the gbrain-evals LICENSE in the section above).
- **Paths:** `world/seed/world.json`, `world/seed/MANIFEST.json`

## gstack-evals: pinned Lane B files

- **What:** byte copies of Lane B runner, config and task-list files from gstack-evals, checked by sha256 ([scripts/gstack-laneb/pin.json](scripts/gstack-laneb/pin.json)).
- **Version:** tag `laneb-quick-2-runner`, commit `443d582c8d909090e80feb0be1e1d9468c8a47ce`.
- **Upstream:** garrytan/gstack-evals. **This repository is private**, so outside readers can't fetch the upstream.
- **Licence:** MIT.
- **Copyright:** Copyright (c) 2026 Garry Tan
- **Paths:** `scripts/gstack-laneb/pinned/`, which carries its own [LICENSE](scripts/gstack-laneb/pinned/LICENSE), copied below.

~~~text
MIT License

Copyright (c) 2026 Garry Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## Credits: Terminal-Bench 2 and SWE-bench Verified

We use these benchmarks' task ids and public numbers. We don't redistribute their task text.

- **Terminal-Bench 2** (Apache License 2.0, https://github.com/harbor-framework/terminal-bench-2, formerly laude-institute/terminal-bench-2, commit `69671fbaac6d67a7ef0dfec016cc38a64ef7a77c`).
  - We keep task ids, per-task source digests and per-task leaderboard numbers only, in `scripts/gstack-laneb/pinned/quick/laneb/tasks/tasks.json` and `final.json`.
  - The leaderboard numbers come from the Terminal-Bench 2 leaderboard (Hugging Face `harborframework/terminal-bench-2-leaderboard`).
  - No task instructions, tests or solutions are in this repository.
- **SWE-bench Verified** (SWE-bench code: MIT, https://github.com/SWE-bench/SWE-bench, Copyright (c) 2023 Carlos E Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik R Narasimhan).
  - We keep instance ids only, in `docs/benchmarks/2026-11-01-opus-gstack-follow/`.
  - Task content is fetched at run time and never redistributed. Problem statements and patches come from the upstream projects, under their own licences.

## Claude Code

- Claude Code is proprietary software of Anthropic. It is not open source, and no licence text applies here.
- Full captures of Claude Code's prompt text and tool schemas are to stay out of the public copy of this repository, which carries their hashes, sizes and short quotations, for commentary. The captures that hold that text today:
  - `docs/harness-anatomy/receipts/anatomy-capture-claude-code-*/blobs/`
  - the Claude Agent SDK and Claude Code parts of `docs/harness-anatomy/receipts/anatomy-capture-qm-claude-plain-20261030t024424/blobs/` (a mixed capture, also listed under QM)
  - `docs/benchmarks/2026-11-01-opus-gstack-follow/results/gn-follow-preset-2026-11/dry-run/preset-system-prompt.txt`
  - the Claude Code spans in `harnesses/ablation/coding/items.json`
- Built harness images are never published. We publish Dockerfiles only.
