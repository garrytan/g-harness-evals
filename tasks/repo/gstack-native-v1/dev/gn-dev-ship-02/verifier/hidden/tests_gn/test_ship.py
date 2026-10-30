import pytest

from tabulate import _textile_row_with_attrs


@pytest.mark.parametrize("cells", [[], ()])
def test_empty_textile_row(cells):
    assert _textile_row_with_attrs(cells, [], []) == "||"
    assert len(cells) == 0


def test_textile_does_not_mutate_cells():
    cells = ["Alice", "42"]
    expected = "|<.Alice |> .42|".replace("> .", ">.")
    first = _textile_row_with_attrs(cells, [5, 2], ["left", "decimal"])
    second = _textile_row_with_attrs(cells, [5, 2], ["left", "decimal"])
    assert cells == ["Alice", "42"]
    assert first == second == expected


def test_textile_accepts_tuple_cells():
    assert _textile_row_with_attrs(("x",), [1], ["center"]) == "|=.x |"
