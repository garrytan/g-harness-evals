"""Header alignment (headersalign)."""

from tabulate import tabulate
from common import assert_equal


def test_headersalign():
    "Output: headersalign aligns the headers on their own"
    result = tabulate(
        [["spam", 41.9999], ["eggs", 451]],
        headers=["item", "qty"],
        headersalign=["center", "left"],
    )
    expected = "\n".join(
        [" item   qty", "------  --------", "spam     41.9999", "eggs    451"]
    )
    assert_equal(expected, result)


def test_headersalign_with_fewer_headers():
    "Output: headersalign follows the headers given, not the padded ones"
    result = tabulate([[1, 2, 3]], headers=["b", "c"], headersalign=["left", "right"])
    expected = "\n".join(["    b      c", "--  ---  ---", " 1    2    3"])
    assert_equal(expected, result)
