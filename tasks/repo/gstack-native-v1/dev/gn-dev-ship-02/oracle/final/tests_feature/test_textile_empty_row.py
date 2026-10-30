from tabulate import _textile_row_with_attrs


def test_empty_textile_row():
    assert _textile_row_with_attrs([], [], []) == "||"
