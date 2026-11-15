import pytest

from tabulate import tabulate


def _one(cell):
    return tabulate([[cell]], tablefmt="bbcode")


def test_layout_with_headers():
    assert tabulate([["a", 1], ["bb", 22]], headers=["x", "y"], tablefmt="bbcode") == (
        "[table]\n[tr][th]x[/th][th]y[/th][/tr]\n[tr][td]a[/td][td]1[/td][/tr]\n"
        "[tr][td]bb[/td][td]22[/td][/tr]\n[/table]"
    )


@pytest.mark.parametrize("cell, expected", [
    ("[b]x[/b]", "&#91;b&#93;x&#91;/b&#93;"),
    ("a & b", "a &amp; b"),
    ("&#91;", "&amp;#91;"),
    ('say "hi" <now>', 'say "hi" <now>'),
    ("it's", "it's"),
])
def test_cell_text_is_escaped(cell, expected):
    assert _one(cell) == "[table]\n[tr][td]" + expected + "[/td][/tr]\n[/table]"


def test_line_breaks_in_cells():
    assert _one("one\ntwo") == "[table]\n[tr][td]one[br]two[/td][/tr]\n[/table]"


def test_line_breaks_keep_one_line_per_row():
    assert tabulate([["one\ntwo", "x"], ["y", "z"]], headers=["a", "b\nc"], tablefmt="bbcode") == (
        "[table]\n[tr][th]a[/th][th]b[br]c[/th][/tr]\n[tr][td]one[br]two[/td][td]x[/td][/tr]\n"
        "[tr][td]y[/td][td]z[/td][/tr]\n[/table]"
    )


def test_missing_values():
    assert tabulate([[None, 1]], tablefmt="bbcode", missingval="n/a") == "[table]\n[tr][td]n/a[/td][td]1[/td][/tr]\n[/table]"


def test_empty_table():
    assert tabulate([], tablefmt="bbcode") == ""


def test_main_formats_still_work():
    assert tabulate([["a", 1]], headers=["x", "y"], tablefmt="dokuwiki") == "^ x   ^   y ^\n| a   |   1 |"
    assert "&lt;b&gt;" in tabulate([["<b>"]], tablefmt="html")
