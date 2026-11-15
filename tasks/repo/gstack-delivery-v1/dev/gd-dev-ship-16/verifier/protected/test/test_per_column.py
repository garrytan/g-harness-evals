"""Per-column options given as tuples."""

from tabulate import tabulate
from common import assert_equal


def test_maxcolwidths_tuple():
    "Input: maxcolwidths can be a tuple"
    result = tabulate([["aaaa bbbb", 1]], maxcolwidths=(4, None))
    expected = "\n".join(["----  -", "aaaa  1", "bbbb", "----  -"])
    assert_equal(expected, result)


def test_rowalign_tuple():
    "Input: rowalign can be a tuple"
    result = tabulate(
        [["a\nb", "c"], ["d", "e\nf"]], rowalign=("bottom", "top"), tablefmt="grid"
    )
    expected = "\n".join(
        [
            "+---+---+",
            "| a |   |",
            "| b | c |",
            "+---+---+",
            "| d | e |",
            "|   | f |",
            "+---+---+",
        ]
    )
    assert_equal(expected, result)


def test_floatfmt_longer_than_the_table():
    "Input: per-column formats beyond the last column are ignored"
    result = tabulate([[1.23456, 2.5, 3]], floatfmt=(".1f", ".2f", "g", "g"))
    expected = "\n".join(["---  ----  -", "1.2  2.50  3", "---  ----  -"])
    assert_equal(expected, result)
