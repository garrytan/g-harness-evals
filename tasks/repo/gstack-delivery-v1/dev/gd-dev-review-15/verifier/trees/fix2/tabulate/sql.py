"""Write a table as SQL statements that create a database table and fill it.

    >>> print(to_sql([["spam", 41.5], ["eggs", 451]], "stock", headers=["item", "qty"]))
    CREATE TABLE "stock" ("item" TEXT, "qty" REAL);
    INSERT INTO "stock" ("item", "qty") VALUES
    ('spam', 41.5),
    ('eggs', 451.0);
    <BLANKLINE>

"""

import math

from . import _column_type, _normalize_tabular_data, _remove_separating_lines

__all__ = ["to_sql", "write_sql"]


# Rows per INSERT statement, so that a large table is not one huge statement.
_ROWS_PER_INSERT = 500

_SQL_TYPES = {int: "INTEGER", float: "REAL"}


def _quote_name(name):
    """Quote a table or column name as an SQL identifier.

    >>> _quote_name("order")
    '"order"'

    """
    return '"' + str(name).replace('"', '""') + '"'


def _string_literal(value):
    """Quote a value as an SQL string literal.

    >>> _string_literal("spam")
    "'spam'"

    """
    return "'" + str(value).replace("'", "''") + "'"


def _literal(value, coltype):
    """The SQL literal for one value of a column of type `coltype`."""
    if value is None:
        return "NULL"
    if coltype is int:
        return str(int(value))
    if coltype is float:
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return "NULL"
        return repr(number)
    return _string_literal(value)


def _create(table, headers, coltypes, replace):
    """The statements that create the table."""
    statements = []
    if replace:
        statements.append("DROP TABLE IF EXISTS " + table + ";")
    statements.append(_create_table(table, headers, coltypes))
    return statements


def _create_table(table, headers, coltypes):
    """The CREATE TABLE statement, with one typed column per header."""
    columns = ", ".join(
        _quote_name(name) + " " + _SQL_TYPES.get(coltype, "TEXT")
        for name, coltype in zip(headers, coltypes)
    )
    return "CREATE TABLE IF NOT EXISTS " + _quote_name(table) + " (" + columns + ");"


def _inserts(table, headers, coltypes, rows):
    """The INSERT statements for the rows, at most _ROWS_PER_INSERT rows each."""
    names = ", ".join(_quote_name(name) for name in headers)
    prefix = "INSERT INTO " + _quote_name(table) + " (" + names + ") VALUES\n"
    statements = []
    for start in range(0, len(rows), _ROWS_PER_INSERT):
        values = ",\n".join(
            "(" + ", ".join(_literal(v, t) for v, t in zip(row, coltypes)) + ")"
            for row in rows[start : start + _ROWS_PER_INSERT]
        )
        statements.append(prefix + values + ";")
    return statements


def to_sql(tabular_data, table, headers="keys", replace=False, disable_numparse=False):
    """Return SQL statements that create `table` and insert every row of the data.

    `tabular_data` and `headers` are what `tabulate` accepts, and every
    column needs a header: it becomes the column's name. Column types follow
    the types tabulate finds: INTEGER, REAL or TEXT. If `replace` is true, an
    existing table of that name is dropped first.

    """
    rows, headers = _normalize_tabular_data(tabular_data, headers)
    rows, _ = _remove_separating_lines(rows)
    if not headers or "" in headers:
        raise ValueError("to_sql needs a header for every column")

    ncols = len(headers)
    rows = [list(row) + [None] * (ncols - len(row)) for row in rows]
    columns = list(zip(*rows)) or [()] * ncols
    coltypes = [_column_type(col, numparse=not disable_numparse) for col in columns]

    statements = _create(table, headers, coltypes, replace)
    statements.extend(_inserts(table, headers, coltypes, rows))
    return "\n".join(statements) + "\n"


def write_sql(path, tabular_data, table, headers="keys", replace=False):
    """Write the statements of `to_sql` to the file at `path`."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(to_sql(tabular_data, table, headers=headers, replace=replace))
