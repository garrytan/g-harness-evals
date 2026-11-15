#!/usr/bin/env python
from tests import unittest
from datetime import datetime, timedelta
import itertools
import json

import jmespath
from jmespath import exceptions
from jmespath import functions


class TestFunctions(unittest.TestCase):

    def test_can_max_datetimes(self):
        # This is python specific behavior, but JMESPath does not specify what
        # you should do with language specific types.  We're going to add the
        # ability that ``to_string`` will always default to str()'ing values it
        # doesn't understand.
        data = [datetime.now(), datetime.now() + timedelta(seconds=1)]
        result = jmespath.search('max([*].to_string(@))', data)
        self.assertEqual(json.loads(result), str(data[-1]))

    def test_type_error_messages(self):
        with self.assertRaises(exceptions.JMESPathTypeError) as e:
            jmespath.search('length(@)', 2)
        exception = e.exception
        # 1. Function name should be in error message
        self.assertIn('length()', str(exception))
        # 2. Mention it's an invalid type
        self.assertIn('invalid type for value: 2', str(exception))
        # 3. Mention the valid types:
        self.assertIn("expected one of: ['string', 'array', 'object']",
                      str(exception))
        # 4. Mention the actual type.
        self.assertIn('received: "number"', str(exception))

    def test_singular_in_error_message(self):
        with self.assertRaises(exceptions.ArityError) as e:
            jmespath.search('length(@, @)', [0, 1])
        exception = e.exception
        self.assertEqual(
            str(exception),
            'Expected 1 argument for function length(), received 2')

    def test_error_message_is_pluralized(self):
        with self.assertRaises(exceptions.ArityError) as e:
            jmespath.search('sort_by(@)', [0, 1])
        exception = e.exception
        self.assertEqual(
            str(exception),
            'Expected 2 arguments for function sort_by(), received 1')

    def test_variadic_is_pluralized(self):
        with self.assertRaises(exceptions.VariadictArityError) as e:
            jmespath.search('not_null()', 'foo')
        exception = e.exception
        self.assertEqual(
            str(exception),
            'Expected at least 1 argument for function not_null(), received 0')


class TestEveryFunction(unittest.TestCase):
    # Values of each JMESPath type.  Every built-in function, called with
    # any combination of these that its signature allows, returns a value or
    # raises a JMESPathError; it never lets a Python error escape.
    SAMPLES = {
        'number': [0, -1, 2, 1.5],
        'string': ['', 'a b'],
        'boolean': [True, False],
        'null': [None],
        'array': [[], [1, 'a']],
        'object': [{}, {'a': 1}],
        'array-number': [[], [1, 2.5]],
        'array-string': [[], ['a', 'b']],
    }

    def test_arguments_of_the_declared_types_raise_only_jmespath_errors(self):
        runtime = functions.Functions()
        failures = []
        for name, spec in sorted(runtime.FUNCTION_TABLE.items()):
            choices = []
            for argument in spec['signature']:
                types = argument['types'] or list(self.SAMPLES)
                if 'expref' in types:
                    break
                choices.append([v for t in types for v in self.SAMPLES[t]])
            else:
                for args in itertools.product(*choices):
                    try:
                        runtime.call_function(name, list(args))
                    except exceptions.JMESPathError:
                        pass
                    except Exception as e:
                        failures.append('%s%r raised %r' % (name, args, e))
        self.assertEqual(failures, [])
