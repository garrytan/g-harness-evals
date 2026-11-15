import json
import sqlite3
import unittest

import jmespath
from jmespath.sqlite import UnsupportedExpressionError, select, where


DOCS = [
    {'name': 'Ann', 'age': 31, 'team': {'name': 'core'}},
    {'name': 'Bob', 'age': 25, 'team': {'name': 'web'}},
    {'name': 'Cid', 'age': 42},
    {'name': 'Dee', 'age': 25.5, 'team': {'name': 'core'}},
]


class TestSQLiteWhere(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.execute('CREATE TABLE people (data TEXT)')
        self.conn.executemany('INSERT INTO people VALUES (?)',
                              [(json.dumps(doc),) for doc in DOCS])

    def tearDown(self):
        self.conn.close()

    def assert_same_as_search(self, condition):
        self.assertEqual(select(self.conn, 'people', condition),
                         jmespath.search('[?' + condition + ']', DOCS))

    def test_comparisons(self):
        for condition in ["name == 'Bob'", "name != 'Bob'", 'age > `30`',
                          'age <= `25.5`', "team.name == 'core'",
                          'age == `25`']:
            self.assert_same_as_search(condition)

    def test_boolean_operators(self):
        for condition in ["age > `30` && team.name == 'core'",
                          "name == 'Bob' || name == 'Cid'",
                          "!(team.name == 'core')"]:
            self.assert_same_as_search(condition)

    def test_starts_and_ends_with(self):
        self.assert_same_as_search("starts_with(name, 'A')")
        self.assert_same_as_search("ends_with(name, 'e')")

    def test_literal_on_the_left(self):
        self.assert_same_as_search("'Bob' == name")

    def test_values_are_parameters(self):
        sql, params = where("name == 'Bob'")
        self.assertNotIn('Bob', sql)
        self.assertIn('Bob', params)

    def test_unsupported_expressions(self):
        for condition in ['age > height', 'length(name) > `2`', 'name',
                          "tags[0] == 'x'"]:
            with self.assertRaises(UnsupportedExpressionError):
                where(condition)


if __name__ == '__main__':
    unittest.main()
