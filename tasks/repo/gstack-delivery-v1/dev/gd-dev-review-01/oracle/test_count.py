from tabulate.export import export_html


def test_row_count_does_not_include_the_header_row(tmp_path):
    data = [["item", "qty"], ["spam", 1], ["eggs", 2]]
    export_html(str(tmp_path), {"t": data}, headers="firstrow")
    assert "(2 rows)" in (tmp_path / "index.html").read_text()
