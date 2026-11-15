import inspect
import unittest

import bottle


class TestPublicApi(unittest.TestCase):

    def test_exported_names_exist(self):
        missing = [name for name in bottle.__all__ if not hasattr(bottle, name)]
        self.assertEqual([], missing)
        self.assertEqual(len(bottle.__all__), len(set(bottle.__all__)))

    def test_public_definitions_are_exported(self):
        """ Every public function and class defined in bottle is in __all__. """
        missing = []
        for name, obj in vars(bottle).items():
            if name.startswith('_'):
                continue
            if not (inspect.isfunction(obj) or inspect.isclass(obj)):
                continue
            if obj.__module__ == 'bottle' and obj.__name__ == name \
                    and name not in bottle.__all__:
                missing.append(name)
        self.assertEqual([], sorted(missing))

    def test_star_import(self):
        ns = {}
        exec('from bottle import *', ns)
        self.assertEqual(sorted(bottle.__all__), sorted(n for n in ns if n != '__builtins__'))
        self.assertNotIn('callable', ns)
        self.assertNotIn('json_dumps', ns)
