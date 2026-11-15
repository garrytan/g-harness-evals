from tabulate.export import export_html


def test_the_table_is_not_escaped_twice(tmp_path):
    export_html(str(tmp_path), {"t": [["a & b"]]}, headers=["x"])
    page = (tmp_path / "t.html").read_text()
    assert page.count("<table>") == 1
    assert "&amp;amp;" not in page
