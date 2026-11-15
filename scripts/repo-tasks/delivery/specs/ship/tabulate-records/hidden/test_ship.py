import pytest

from tabulate import tabulate, to_records

SEP = "\x01"


def test_list_of_lists_with_headers():
    rows = [["spam", 41.9999, None], ["eggs", "451.0", "007"]]
    assert to_records(rows, headers=["item", "qty", "code"]) == [
        {"item": "spam", "qty": 41.9999, "code": None},
        {"item": "eggs", "qty": "451.0", "code": "007"},
    ]


def test_values_are_not_parsed():
    assert to_records([["007", "1.50", True, 2.5]], headers=["a", "b", "c", "d"]) == [
        {"a": "007", "b": "1.50", "c": True, "d": 2.5}
    ]


def test_keys_are_column_numbers_for_lists():
    assert to_records([[1, 2, 3], [4, 5, 6]]) == [{"0": 1, "1": 2, "2": 3}, {"0": 4, "1": 5, "2": 6}]


def test_keys_of_dicts():
    assert to_records([{"a": 1}, {"b": 2}]) == [{"a": 1, "b": None}, {"a": None, "b": 2}]


def test_dict_keys_become_strings():
    assert to_records([{1: "x", 2: "y"}]) == [{"1": "x", "2": "y"}]


def test_header_names_for_dicts():
    assert to_records([{"a": 1, "b": 2}], headers={"a": "Alpha"}) == [{"Alpha": 1, "b": 2}]


def test_dict_of_columns():
    assert to_records({"x": [1, 2, 3], "y": ["a"]}) == [
        {"x": 1, "y": "a"},
        {"x": 2, "y": None},
        {"x": 3, "y": None},
    ]


def test_firstrow():
    assert to_records([["x", "y"], [1, 2], [3, 4]], headers="firstrow") == [
        {"x": 1, "y": 2},
        {"x": 3, "y": 4},
    ]


@pytest.mark.parametrize("rows, headers, expected", [
    ([["a", 1, 2], ["b"]], ["x", "y", "z"], [{"x": "a", "y": 1, "z": 2}, {"x": "b", "y": None, "z": None}]),
    ([[1]], ["a", "b"], [{"a": 1, "b": None}]),
    ([["a", 1], []], ["x", "y"], [{"x": "a", "y": 1}, {"x": None, "y": None}]),
])
def test_short_rows_get_none(rows, headers, expected):
    assert to_records(rows, headers=headers) == expected


@pytest.mark.parametrize("rows", [
    [["a", 1], SEP, ["b", 2]],
    [["a", 1], [SEP], ["b", 2]],
    [SEP, ["a", 1], ["b", 2], SEP],
])
def test_separating_lines_are_left_out(rows):
    assert to_records(rows, headers=["x", "y"]) == [{"x": "a", "y": 1}, {"x": "b", "y": 2}]


def test_empty():
    assert to_records([]) == []
    assert to_records(None) == []
    assert to_records([], headers=["a"]) == []


def test_tabulate_still_works():
    assert tabulate([["spam", 41.9999]], headers=["item", "qty"]) == "item        qty\n------  -------\nspam    41.9999"
    assert tabulate(None) == ""


def test_headersalign():
    assert tabulate([["spam", 41.9999], ["eggs", 451]], headers=["item", "qty"], headersalign=["center", "left"]) == (
        " item   qty\n------  --------\nspam     41.9999\neggs    451"
    )


def test_headersalign_names_the_given_headers():
    assert tabulate([[1, 2, 3]], headers=["b", "c"], headersalign=["left", "right"]) == "    b      c\n--  ---  ---\n 1    2    3"
