# Recall rerun analysis (written by scripts/corrections/recall-rerun-analysis.ts)

Seed 7, 10,000 draws, pairs by task and repetition, clustered by task. Exposure confirmed: yes.

## Exposure

| Cell | Trials | Remembers | To a channel source | Private | No write_source | Channel saves read by another member | Reads by another member returning one | Trials with such a read |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `zero-lean-mcp-instructions-opus-gbrain-conv-mu-v03-dev2` | 12 | 25 | 25 | 0 | 0 | 12 | 13 | 6 |
| `zero-lean-opus-gbrain-conv-mu-v03-dev2` | 12 | 24 | 24 | 0 | 0 | 20 | 20 | 11 |
| `claude-code-opus-gbrain-conv-mu-v03-dev2` | 12 | 13 | 13 | 0 | 0 | 12 | 12 | 9 |

## Readings (points)

| Reading | Published (60) | Published, cr only (12) | Rerun (12) [95% CI] | Spliced (60) [95% CI] | Spliced minus published | Ceiling | Share of the gap to the ceiling recovered | Verdict |
|---|---|---|---|---|---:|---:|---:|---|
| 13-1 lean + MCP instructions + gbrain minus lean | 5 [-8.3, 21.7] | -16.7 | -8.3 [-25, 0] (n=12) | 6.7 [-5, 23.3] (n=60) | 1.7 | 20 | 11.1% | FIX-METHOD (dev) stands |
| 14-1 lean + gbrain minus lean | 1.7 [-10, 15] | -16.7 | -8.3 [-25, 0] (n=12) | 3.3 [-8.3, 16.7] (n=60) | 1.7 | 16.7 | 11.1% | FIX-METHOD (dev) stands |
| 15-5 Claude Code + gbrain minus Claude Code | 3.3 [-6.7, 15] | -8.3 | 0 [0, 0] (n=12) | 5 [-3.3, 15] (n=60) | 1.7 | 10 | 25% | FIX-METHOD (dev) stands |
