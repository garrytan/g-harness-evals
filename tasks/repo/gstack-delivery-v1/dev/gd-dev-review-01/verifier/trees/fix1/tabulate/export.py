"""Write named tables as HTML pages in a directory, with an index page."""

import html
import os
import re

from . import _is_separating_line, _normalize_tabular_data, tabulate

__all__ = ["export_html"]


# No path separators and no leading dot, so every page lands in the directory.
_NAME = re.compile(r"[^./\\][^/\\]*")

_PAGE = """\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{title}</title>
</head>
<body>
<h1>{title}</h1>
{body}
</body>
</html>
"""


def _check_name(name):
    """Return `name` if it can name a table's page, else raise ValueError."""
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        raise ValueError("invalid table name: {!r}".format(name))
    return name


def _row_count(data, headers="keys"):
    """The number of data rows of a table; separating lines do not count."""
    rows, _ = _normalize_tabular_data(data, headers)
    return sum(1 for row in rows if not _is_separating_line(row))


def _table_page(data, headers, heading):
    """The body of a table's page: its heading and the table."""
    table = tabulate(data, headers, tablefmt="unsafehtml")
    return "<h2>{}</h2>\n{}".format(heading, table)


def _write_page(path, title, body):
    """Write one page of the export."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(_PAGE.format(title=html.escape(title), body=body))


def _index_item(name, tip, data, headers):
    """The index page's link to one table, with its number of data rows."""
    count = _row_count(data)
    if count == 1:
        rows = "1 row"
    else:
        rows = "{} rows".format(count)
    return '<li><a href="{0}.html" title="{1}">{0}</a> ({2})</li>'.format(
        name, tip, rows
    )


def export_html(directory, tables, captions=None, title="Tables", headers="keys"):
    """Write each table to `<directory>/<name>.html` and an index.html linking them.

    `tables` maps table names to tabular data (anything `tabulate` accepts),
    and `headers` is passed to `tabulate` for every table. `captions` maps
    names to captions; a table's caption, or else its name, is the heading of
    its page and the tooltip of its link. Returns the paths written.

    """
    captions = captions or {}
    names = [_check_name(name) for name in tables]
    os.makedirs(directory, exist_ok=True)

    index = os.path.join(directory, "index.html")
    written = []
    items = []
    for name in names:
        caption = captions.get(name, name)
        heading = html.escape(caption)
        path = os.path.join(directory, name + ".html")
        _write_page(path, caption, _table_page(tables[name], headers, heading))
        written.append(path)
        items.append(_index_item(name, heading, tables[name], headers))

    _write_page(index, title, "<ul>\n" + "\n".join(items) + "\n</ul>")
    written.append(index)
    return written
