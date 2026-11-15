from tabulate import tabulate, to_records


def test_list_of_lists():
    rows = [["spam", 41.9999], ["eggs", "451.0"]]
    assert to_records(rows, headers=["item", "qty"]) == [
        {"item": "spam", "qty": 41.9999},
        {"item": "eggs", "qty": "451.0"},
    ]


def test_keys_of_dicts():
    rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
    assert to_records(rows) == [{"a": 1, "b": 2}, {"a": 3, "b": 4}]


def test_column_numbers():
    assert to_records([[1, 2]]) == [{"0": 1, "1": 2}]


def test_firstrow():
    assert to_records([["x", "y"], [1, 2]], headers="firstrow") == [{"x": 1, "y": 2}]


def test_dict_of_columns():
    columns = {"x": [1, 2], "y": ["a", "b"]}
    assert to_records(columns) == [{"x": 1, "y": "a"}, {"x": 2, "y": "b"}]


def test_empty():
    assert to_records([]) == []
    assert to_records(None) == []


def test_tabulate_accepts_none():
    assert tabulate(None) == ""
