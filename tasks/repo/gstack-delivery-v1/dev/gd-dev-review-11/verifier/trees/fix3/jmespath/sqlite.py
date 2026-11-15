"""Run JMESPath filter conditions inside SQLite.

Documents are stored as JSON text in one column of a table.  A condition
is the part of a filter expression between ``[?`` and ``]``, and a row
matches when ``jmespath.search('[?' + condition + ']', [document])`` would
keep its document.  Only part of the language is supported: comparisons
of a field with a literal, ``starts_with`` and ``ends_with`` of a field
and a string literal, and ``&&``, ``||``, ``!`` and parentheses.  Anything
else raises UnsupportedExpressionError.
"""
import json

from jmespath import exceptions
from jmespath import parser


class UnsupportedExpressionError(exceptions.JMESPathError):
    pass


_OPERATORS = {
    'eq': '=',
    'ne': '=',
    'lt': '<',
    'lte': '<=',
    'gt': '>',
    'gte': '>=',
}

_SWAPPED = {
    'eq': 'eq',
    'ne': 'ne',
    'lt': 'gt',
    'lte': 'gte',
    'gt': 'lt',
    'gte': 'lte',
}


def where(condition, column='data'):
    """Return ``(sql, params)`` for ``condition`` on the JSON in ``column``."""
    compiler = _Compiler(_quote(column))
    sql = compiler.compile(parser.Parser().parse(condition).parsed)
    return sql, compiler.params


def select(conn, table, condition, column='data'):
    """Return the documents in ``table`` that match ``condition``."""
    sql, params = where(condition, column)
    query = 'SELECT %s FROM %s WHERE %s ORDER BY rowid' % (
        _quote(column), _quote(table), sql)
    with conn:
        rows = conn.execute(query, params).fetchall()
    return [json.loads(row[0]) for row in rows]


class _Compiler(object):
    def __init__(self, column):
        self.column = column
        self.params = []

    def compile(self, node):
        method = getattr(self, '_compile_%s' % node['type'], None)
        if method is None:
            raise UnsupportedExpressionError(
                "Unsupported expression: %s" % node['type'])
        return method(node)

    def _compile_and_expression(self, node):
        left, right = node['children']
        return '(%s AND %s)' % (self.compile(left), self.compile(right))

    def _compile_or_expression(self, node):
        left, right = node['children']
        return '(%s OR %s)' % (self.compile(left), self.compile(right))

    def _compile_not_expression(self, node):
        return '(NOT %s)' % self.compile(node['children'][0])

    def _compile_function_expression(self, node):
        name = node['value']
        args = node['children']
        if (name not in ('starts_with', 'ends_with') or len(args) != 2 or
                args[1]['type'] != 'literal' or
                not isinstance(args[1]['value'], str)):
            raise UnsupportedExpressionError(
                "Unsupported function call: %s()" % name)
        text = ''.join('[%s]' % c if c in '*?' else c
                       for c in args[1]['value'])
        path = self._path(args[0])
        type_sql = self._json('json_type', path)
        value_sql = self._json('json_extract', path)
        if name == 'starts_with':
            self.params.append(text + '*')
        else:
            self.params.append('*' + text)
        return "IFNULL(%s = 'text' AND %s GLOB ?, 0)" % (type_sql, value_sql)

    def _compile_comparator(self, node):
        left, right = node['children']
        if right['type'] == 'literal':
            return self._compare(self._path(left), node['value'],
                                 right['value'])
        if left['type'] == 'literal':
            return self._compare(self._path(right), _SWAPPED[node['value']],
                                 left['value'])
        raise UnsupportedExpressionError(
            "A comparison needs a literal on one side")

    def _json(self, function, path):
        self.params.append(path)
        return '%s(%s, ?)' % (function, self.column)

    def _path(self, node):
        if node['type'] == 'field':
            keys = [node['value']]
        elif node['type'] == 'subexpression' and all(
                child['type'] == 'field' for child in node['children']):
            keys = [child['value'] for child in node['children']]
        else:
            raise UnsupportedExpressionError(
                "Only field names and paths can be compared")
        if '"' in node.get('value', ''):
            raise UnsupportedExpressionError(
                "Field names may not contain a double quote")
        return '$' + ''.join('."%s"' % key for key in keys)

    def _compare(self, path, op, value):
        if value is None:
            kind = 'null'
        elif isinstance(value, bool):
            kind = 'true' if value else 'false'
        elif isinstance(value, (int, float)):
            kind = 'number'
        elif isinstance(value, str):
            kind = 'text'
        else:
            raise UnsupportedExpressionError(
                "Only strings, numbers, booleans and null can be compared")
        if kind in ('null', 'true', 'false'):
            if op not in ('eq', 'ne'):
                return '0'
            sql = "IFNULL(%s, 'null') = '%s'" % (
                self._json('json_type', path), kind)
        else:
            types = "('integer', 'real')" if kind == 'number' else "('text')"
            type_sql = self._json('json_type', path)
            value_sql = self._json('json_extract', path)
            self.params.append(value)
            sql = 'IFNULL(%s IN %s AND %s %s ?, 0)' % (
                type_sql, types, value_sql, _OPERATORS[op])
        if op == 'ne':
            return '(NOT %s)' % sql
        return sql


def _quote(name):
    return '"' + name.replace('"', '""') + '"'
