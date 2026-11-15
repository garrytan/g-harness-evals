from html.parser import HTMLParser

from tabulate.export import export_html


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.append(dict(attrs)["href"])


def test_links_to_every_page_in_order(tmp_path):
    names = ["b-2", "a.1", "C_3"]
    export_html(str(tmp_path), {name: [[1]] for name in names})
    parser = _Links()
    parser.feed((tmp_path / "index.html").read_text())
    assert parser.links == [name + ".html" for name in names]
    assert all((tmp_path / (name + ".html")).exists() for name in names)
