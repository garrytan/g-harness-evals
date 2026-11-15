from html.parser import HTMLParser

from tabulate.export import export_html


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.append(dict(attrs))


def test_a_caption_with_quotes_stays_in_the_tooltip(tmp_path):
    caption = 'say "hi" onmouseover="alert(1)'
    export_html(str(tmp_path), {"t": [[1]]}, captions={"t": caption})
    parser = _Links()
    parser.feed((tmp_path / "index.html").read_text())
    assert parser.links == [{"href": "t.html", "title": caption}]
