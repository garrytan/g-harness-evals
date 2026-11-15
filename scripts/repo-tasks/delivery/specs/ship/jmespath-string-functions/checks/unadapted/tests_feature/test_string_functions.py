import unittest

import jmespath
from jmespath import exceptions


class TestStringFunctions(unittest.TestCase):
    def test_lower_and_upper(self):
        self.assertEqual(jmespath.search('lower(@)', 'MiXed'), 'mixed')
        self.assertEqual(jmespath.search('upper(@)', 'MiXed'), 'MIXED')

    def test_trim(self):
        self.assertEqual(jmespath.search('trim(@)', '  padded \t'), 'padded')
        self.assertEqual(jmespath.search("trim(@, '-')", '--a-b--'), 'a-b')

    def test_split(self):
        self.assertEqual(jmespath.search("split(@, ',')", 'a,b,c'),
                         ['a', 'b', 'c'])
        self.assertEqual(jmespath.search("split(@, ',', `1`)", 'a,b,c'),
                         ['a', 'b,c'])

    def test_in_a_projection(self):
        data = {'people': [{'name': ' Ann '}, {'name': 'BOB'}]}
        self.assertEqual(
            jmespath.search('people[].lower(trim(name))', data),
            ['ann', 'bob'])

    def test_arity(self):
        with self.assertRaises(exceptions.ArityError):
            jmespath.search('trim()', 'a')
        with self.assertRaises(exceptions.ArityError):
            jmespath.search("split(@, ',', `1`, `2`)", 'a')

    def test_types(self):
        with self.assertRaises(exceptions.JMESPathTypeError):
            jmespath.search('upper(@)', 5)
