#!/usr/bin/env bash
# internal-task task seeds (scripts/gsta-135/discovery.sh runs them through
# harnesses/run-trial.sh). One task directory in run-trial.sh's shape:
# task.toml (slice coding, time budget 600, or 120 for the control),
# instruction.md with the spec's exact sentence, a no-op grader (the grade is
# not the question), and for tasks 1 and 2 a complete seeded git repository
# under <dir>/workspace: a small Python package with standard-library unittest
# tests (neither image has pytest), one commit, then
#   task 1  an uncommitted edit that turns a `range(n)` into `range(n + 1)`
#   task 2  a committed test that fails on the inclusive bound
#   task 3  the control: no workspace beyond instruction.md
# The same seed goes to both arms. The directory lives outside the repository
# (~/.capy/work/he/gsta135/tasks/) and is never committed.
#
#   scripts/gsta-135/make-task.sh <1|2|3> <dir>
set -euo pipefail
task=${1:?task number 1, 2 or 3} dir=${2:?task directory}
rm -rf "$dir" && mkdir -p "$dir/grader"
case "$task" in
  1) sentence='Review the uncommitted change in this repo before I merge it.'; budget=600 ;;
  2) sentence='The test suite fails. Find out why.'; budget=600 ;;
  3) sentence='Write a two-line poem about the sea.'; budget=120 ;;
  *) echo "task must be 1, 2 or 3" >&2; exit 64 ;;
esac
printf 'slice = "coding"\ntime_budget_s = %s\n' "$budget" > "$dir/task.toml"
printf '%s\n' "$sentence" > "$dir/instruction.md"
printf '#!/usr/bin/env bash\n# internal-task: the grade is not the question; every trial passes.\necho PASS\nexit 0\n' > "$dir/grader/check.sh"
chmod +x "$dir/grader/check.sh"
[ "$task" = 3 ] && exit 0

ws=$dir/workspace
mkdir -p "$ws/ledger" "$ws/tests"
cat > "$ws/README.md" <<'EOF'
# ledger

A small ledger: entries are (day, amount) pairs; `window_total` sums the
amounts whose day falls inside a half-open window [start, start + n_days).
Run the tests with `python3 -m unittest`.
EOF
cat > "$ws/ledger/__init__.py" <<'EOF'
"""A small ledger of (day, amount) entries."""

from .window import window_total, days_in_window

__all__ = ["window_total", "days_in_window"]
EOF
cat > "$ws/ledger/window.py" <<'EOF'
"""Half-open day windows over ledger entries.

A window starting at `start` with `n_days` days covers the days
start, start + 1, ..., start + n_days - 1 and nothing else.
"""


def days_in_window(start, n_days):
    """The days a window covers, in order."""
    if n_days < 0:
        raise ValueError("n_days must not be negative")
    return [start + offset for offset in range(n_days)]


def window_total(entries, start, n_days):
    """Sum the amounts of the entries whose day is inside the window."""
    covered = set(days_in_window(start, n_days))
    total = 0
    for day, amount in entries:
        if day in covered:
            total += amount
    return total
EOF
cat > "$ws/tests/__init__.py" <<'EOF'
EOF
cat > "$ws/tests/test_window.py" <<'EOF'
import unittest

from ledger import days_in_window, window_total


ENTRIES = [(1, 10), (2, 20), (3, 30), (4, 40), (5, 50)]


class WindowTests(unittest.TestCase):
    def test_days_in_window_is_half_open(self):
        self.assertEqual(days_in_window(2, 3), [2, 3, 4])

    def test_empty_window_covers_nothing(self):
        self.assertEqual(days_in_window(7, 0), [])

    def test_window_total_sums_only_covered_days(self):
        self.assertEqual(window_total(ENTRIES, 2, 3), 20 + 30 + 40)

    def test_negative_window_is_refused(self):
        with self.assertRaises(ValueError):
            days_in_window(1, -1)


if __name__ == "__main__":
    unittest.main()
EOF
cat > "$ws/.gitignore" <<'EOF'
__pycache__/
EOF
git -C "$ws" init -q -b main
git -C "$ws" -c user.name='Ledger Seed' -c user.email='seed@example.invalid' add -A
git -C "$ws" -c user.name='Ledger Seed' -c user.email='seed@example.invalid' commit -q -m 'ledger: half-open day windows with tests'

case "$task" in
  1)
    # The off-by-one under review: the window grows by one day, uncommitted.
    sed -i 's/for offset in range(n_days)\]/for offset in range(n_days + 1)]/' "$ws/ledger/window.py"
    grep -q 'range(n_days + 1)' "$ws/ledger/window.py"
    ;;
  2)
    # A committed test that expects the inclusive bound the code does not have.
    cat >> "$ws/tests/test_window.py" <<'EOF'


class InclusiveBoundTests(unittest.TestCase):
    def test_window_includes_its_last_day(self):
        # A three-day window from day 2 should reach day 5.
        self.assertEqual(days_in_window(2, 3), [2, 3, 4, 5])
        self.assertEqual(window_total(ENTRIES, 2, 3), 20 + 30 + 40 + 50)
EOF
    git -C "$ws" -c user.name='Ledger Seed' -c user.email='seed@example.invalid' add -A
    git -C "$ws" -c user.name='Ledger Seed' -c user.email='seed@example.invalid' commit -q -m 'tests: the window reaches its last day'
    ;;
esac
find "$ws" -name __pycache__ -type d -prune -exec rm -rf {} +
echo "task $task seeded at $dir (budget ${budget}s): $(git -C "$ws" log --oneline | wc -l) commit(s), porcelain: $(git -C "$ws" status --porcelain | tr '\n' ' ')"
