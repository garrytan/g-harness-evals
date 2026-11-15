"""Tests of the HTML export."""

import os

from pytest import raises

from tabulate import tabulate
from tabulate.export import export_html


def test_pages_and_index(tmp_path):
    "Export: one page per table and an index"
    tables = {"fruit": [["apple", 3], ["pear", 5]], "veg": [["leek", 1]]}
    written = export_html(str(tmp_path), tables, headers=["item", "qty"])
    assert written == [
        os.path.join(str(tmp_path), "fruit.html"),
        os.path.join(str(tmp_path), "veg.html"),
        os.path.join(str(tmp_path), "index.html"),
    ]
    index = (tmp_path / "index.html").read_text()
    assert '<li><a href="fruit.html" title="fruit">fruit</a> (2 rows)</li>' in index
    assert '<li><a href="veg.html" title="veg">veg</a> (1 row)</li>' in index
    assert index.index("fruit.html") < index.index("veg.html")


def test_table_page(tmp_path):
    "Export: a table's page holds its heading and the html table"
    data = [["apple", 3], ["pear", 5]]
    export_html(str(tmp_path), {"fruit": data}, headers=["item", "qty"])
    page = (tmp_path / "fruit.html").read_text()
    assert "<title>fruit</title>" in page
    assert "<h2>fruit</h2>\n" + tabulate(data, ["item", "qty"], tablefmt="html") in page


def test_captions(tmp_path):
    "Export: a caption is the heading and the tooltip"
    export_html(str(tmp_path), {"fruit": [["apple"]]}, captions={"fruit": "Fruit & nuts"})
    page = (tmp_path / "fruit.html").read_text()
    index = (tmp_path / "index.html").read_text()
    assert "<h2>Fruit &amp; nuts</h2>" in page
    assert 'title="Fruit &amp; nuts"' in index


def test_title(tmp_path):
    "Export: the index page has the title"
    export_html(str(tmp_path), {"a": [[1]]}, title="Q3 <draft>")
    index = (tmp_path / "index.html").read_text()
    assert "<title>Q3 &lt;draft&gt;</title>" in index
    assert "<h1>Q3 &lt;draft&gt;</h1>" in index


def test_invalid_names(tmp_path):
    "Export: names that are not plain file names are refused"
    for name in ["", "../up", "/abs", ".hidden"]:
        with raises(ValueError):
            export_html(str(tmp_path / "out"), {name: [[1]]})
