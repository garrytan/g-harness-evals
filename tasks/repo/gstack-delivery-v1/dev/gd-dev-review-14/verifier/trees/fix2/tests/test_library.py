import os
import shutil
import tempfile
import unittest

from jmespath import exceptions
from jmespath.library import (
    InvalidQueryNameError, QueryLibrary, UnknownQueryError)


class TestQueryLibrary(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.library = QueryLibrary(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_save_and_search(self):
        self.library.save('active', 'people[?active].name')
        data = {'people': [{'name': 'a', 'active': True},
                           {'name': 'b', 'active': False}]}
        self.assertEqual(self.library.search('active', data), ['a'])
        self.assertEqual(QueryLibrary(self.root).search('active', data),
                         ['a'])

    def test_files_are_plain_text(self):
        self.library.save('first', 'people[0]')
        with open(os.path.join(self.root, 'first.jmespath')) as f:
            self.assertEqual(f.read(), 'people[0]\n')

    def test_comments_and_several_lines(self):
        with open(os.path.join(self.root, 'adults.jmespath'), 'w') as f:
            f.write('# People who may sign.\npeople[?age >= `18`]\n  .name\n')
        data = {'people': [{'name': 'a', 'age': 30}, {'name': 'b', 'age': 9}]}
        self.assertEqual(self.library.search('adults', data), ['a'])

    def test_names(self):
        self.library.save('b', 'b')
        self.library.save('a', 'a')
        self.assertEqual(self.library.names(), ['a', 'b'])

    def test_delete(self):
        self.library.save('a', 'a')
        self.library.save('b', 'b')
        self.library.delete('a')
        self.assertEqual(self.library.names(), ['b'])
        with self.assertRaises(UnknownQueryError):
            self.library.get('a')

    def test_unknown_query(self):
        with self.assertRaises(UnknownQueryError):
            self.library.get('missing')
        with self.assertRaises(UnknownQueryError):
            self.library.delete('missing')

    def test_names_outside_the_library(self):
        for name in ['../escape', '/etc/passwd', 'a/../../escape']:
            with self.assertRaises(InvalidQueryNameError):
                self.library.get(name)

    def test_invalid_expression(self):
        with self.assertRaises(exceptions.ParseError):
            self.library.save('broken', 'foo[')


if __name__ == '__main__':
    unittest.main()
