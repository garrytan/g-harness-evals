import unittest

import jmespath
from jmespath import exceptions


PEOPLE = [
    {'name': 'a', 'team': 'core'},
    {'name': 'b', 'team': 'web'},
    {'name': 'c', 'team': 'core'},
]


class TestGroupBy(unittest.TestCase):
    def test_groups_by_key(self):
        self.assertEqual(
            jmespath.search('group_by(@, &team)', PEOPLE),
            {'core': [PEOPLE[0], PEOPLE[2]], 'web': [PEOPLE[1]]})

    def test_keys_in_order_of_first_appearance(self):
        self.assertEqual(
            jmespath.search('keys(group_by(@, &team))', PEOPLE[1:]),
            ['web', 'core'])

    def test_projection_over_groups(self):
        self.assertEqual(
            jmespath.search('group_by(@, &team).core[].name', PEOPLE),
            ['a', 'c'])

    def test_key_must_be_a_string(self):
        with self.assertRaises(exceptions.JMESPathTypeError):
            jmespath.search('group_by(@, &n)', [{'n': 1}])

    def test_null_keys_are_left_out(self):
        self.assertEqual(
            jmespath.search('group_by(@, &team)',
                            PEOPLE + [{'name': 'd'}, {'name': 'e', 'team': None}]),
            {'core': [PEOPLE[0], PEOPLE[2]], 'web': [PEOPLE[1]]})

    def test_empty_array(self):
        self.assertEqual(jmespath.search('group_by(@, &team)', []), {})
