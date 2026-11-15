from tabulate import tabulate


def test_bbcode_with_headers():
    table = tabulate([["spam", 41], ["eggs", 451]], headers=["item", "qty"], tablefmt="bbcode")
    assert table.splitlines() == [
        "[table]",
        "[tr][th]item[/th][th]qty[/th][/tr]",
        "[tr][td]spam[/td][td]41[/td][/tr]",
        "[tr][td]eggs[/td][td]451[/td][/tr]",
        "[/table]",
    ]


def test_bbcode_without_headers():
    assert tabulate([["a", "b"]], tablefmt="bbcode") == "[table]\n[tr][td]a[/td][td]b[/td][/tr]\n[/table]"
