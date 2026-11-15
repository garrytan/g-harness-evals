import pytest

from tabulate import tabulate


def test_floatfmt_by_name():
    assert tabulate([["spam", 41.9999, 3.14159]], headers=["item", "qty", "price"], floatfmt={"price": ".2f"}) == (
        "item        qty    price\n------  -------  -------\nspam    41.9999     3.14"
    )


def test_colalign_by_name():
    assert tabulate([["spam", 41.9999]], headers=["item", "qty"], colalign={"qty": "left"}) == (
        "item    qty\n------  -------\nspam    41.9999"
    )


def test_missingval_by_name():
    assert tabulate([["a", None, None]], headers=["x", "y", "z"], missingval={"z": "?"}) == (
        "x    y    z\n---  ---  ---\na         ?"
    )


def test_intfmt_by_name():
    assert tabulate([["a", 1234567]], headers=["x", "n"], intfmt={"n": ","}) == "x            n\n---  ---------\na    1,234,567"


def test_maxcolwidths_by_name():
    assert tabulate([["aaaa bbbb", "cccc dddd"]], headers=["x", "y"], maxcolwidths={"y": 4}) == (
        "x          y\n---------  ----\naaaa bbbb  cccc\n           dddd"
    )


def test_headers_from_keys():
    assert tabulate([{"a": 1.23456, "b": 2.5}], headers="keys", floatfmt={"b": ".3f"}) == "      a      b\n-------  -----\n1.23456  2.500"


def test_headers_from_firstrow():
    assert tabulate([["a", "b"], [1.5, 2.26]], headers="firstrow", floatfmt={"b": ".1f"}) == "  a    b\n---  ---\n1.5  2.3"


def test_names_count_the_index_column():
    assert tabulate([[1, "a"]], headers=["n", "s"], showindex=True, colalign={"s": "right"}) == (
        "      n    s\n--  ---  ---\n 0    1    a"
    )


@pytest.mark.parametrize("kwargs, expected", [
    ({"floatfmt": {"x": ".2f"}}, "   x     x    y\n----  ----  ---\n1.50  2.50  3.5"),
    ({"colalign": {"x": "left"}}, "x    x      y\n---  ---  ---\n1.5  2.5  3.5"),
])
def test_a_repeated_header_names_every_column(kwargs, expected):
    assert tabulate([[1.5, 2.5, 3.5]], headers=["x", "x", "y"], **kwargs) == expected


@pytest.mark.parametrize("kwargs", [
    {"floatfmt": {"price": ".2f"}},
    {"colalign": {"qty": "left", "cost": "right"}},
    {"intfmt": {"QTY": ","}},
    {"missingval": {"": "-"}},
    {"maxcolwidths": {"item ": 3}},
])
def test_an_unknown_name_raises(kwargs):
    with pytest.raises(ValueError):
        tabulate([["spam", 41]], headers=["item", "qty"], **kwargs)


@pytest.mark.parametrize("kwargs", [
    {"floatfmt": {"0": ".2f"}},
    {"colalign": {"0": "left"}},
    {"missingval": {"a": "-"}},
])
def test_a_dict_without_headers_raises(kwargs):
    with pytest.raises(ValueError):
        tabulate([[1.5, None]], **kwargs)


def test_lists_and_single_values_work_as_before():
    assert tabulate([["spam", 41.9999, None]], headers=["item", "qty", "note"], floatfmt=[".1f", ".1f"], missingval="-") == (
        "item      qty  note\n------  -----  ------\nspam     42.0  -"
    )
    assert tabulate([["spam", 41.9999]], headers=["item", "qty"], floatfmt=".3f", colalign=["right"]) == (
        "  item     qty\n------  ------\n  spam  42.000"
    )
    assert tabulate([[1, 2]], headers=["a", "b"], colalign=("right", "left")) == "  a  b\n---  ---\n  1  2"


def test_tuples_from_main():
    assert tabulate([["aaaa bbbb", 1]], maxcolwidths=(4, None)) == "----  -\naaaa  1\nbbbb\n----  -"
    assert tabulate([["a\nb", "c"], ["d", "e\nf"]], rowalign=("bottom", "top"), tablefmt="grid") == (
        "+---+---+\n| a |   |\n| b | c |\n+---+---+\n| d | e |\n|   | f |\n+---+---+"
    )
    assert tabulate([[1.23456, 2.5, 3]], floatfmt=(".1f", ".2f", "g", "g")) == "---  ----  -\n1.2  2.50  3\n---  ----  -"


def test_maxcolwidths_by_name_wraps_the_header():
    assert tabulate([["aaaa bbbb", 1]], headers=["long name", "n"], maxcolwidths={"long name": 4}, colalign={"long name": "right"}) == (
        "  long    n\n  name\n------  ---\n  aaaa    1\n  bbbb"
    )


@pytest.mark.parametrize("kwargs, expected", [
    ({"maxcolwidths": [None, 5], "floatfmt": {"unit price": ".2f"}}, "item       unit\n          price\n------  -------\nspam       3.14"),
    ({"maxcolwidths": 5, "colalign": {"unit price": "left"}}, "item    unit\n        price\n------  -------\nspam    3.14159"),
])
def test_names_are_the_headers_before_they_wrap(kwargs, expected):
    assert tabulate([["spam", 3.14159]], headers=["item", "unit price"], **kwargs) == expected
