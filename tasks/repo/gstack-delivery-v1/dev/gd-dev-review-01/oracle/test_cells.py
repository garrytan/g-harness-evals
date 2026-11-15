from tabulate.export import export_html


def test_cell_text_is_escaped(tmp_path):
    export_html(str(tmp_path), {"t": [["<script>alert(1)</script>"]]})
    page = (tmp_path / "t.html").read_text()
    assert "<script>" not in page
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page
