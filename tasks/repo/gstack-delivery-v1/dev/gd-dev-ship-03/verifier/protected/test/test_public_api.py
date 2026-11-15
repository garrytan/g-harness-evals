import inspect
import unittest

import bottle


class TestPublicApi(unittest.TestCase):
    def test_exported_names_exist(self):
        missing = [name for name in bottle.__all__ if not hasattr(bottle, name)]
        self.assertEqual(missing, [])

    def test_no_duplicates(self):
        self.assertEqual(len(bottle.__all__), len(set(bottle.__all__)))

    def test_public_functions_and_classes_are_exported(self):
        unexported = sorted(
            name for name, obj in vars(bottle).items()
            if not name.startswith('_')
            and (inspect.isfunction(obj) or inspect.isclass(obj))
            and getattr(obj, '__module__', None) == 'bottle'
            and name not in bottle.__all__)
        self.assertEqual(unexported, [])

    def test_star_import(self):
        namespace = {}
        exec('from bottle import *', namespace)
        self.assertIn('route', namespace)
        self.assertIn('request', namespace)
        self.assertNotIn('sys', namespace)
        self.assertNotIn('_parse_http_header', namespace)
