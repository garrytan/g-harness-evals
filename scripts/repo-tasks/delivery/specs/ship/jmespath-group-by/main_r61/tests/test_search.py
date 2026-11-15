import sys
import decimal
from tests import unittest, OrderedDict

import jmespath
import jmespath.functions


class TestSearchOptions(unittest.TestCase):
    def test_can_provide_dict_cls(self):
        result = jmespath.search(
            '{a: a, b: b, c: c}.*',
            {'c': 'c', 'b': 'b', 'a': 'a', 'd': 'd'},
            options=jmespath.Options(dict_cls=OrderedDict))
        self.assertEqual(result, ['a', 'b', 'c'])

    def test_can_provide_custom_functions(self):
        class CustomFunctions(jmespath.functions.Functions):
            @jmespath.functions.signature(
                {'types': ['number']},
                {'types': ['number']})
            def _func_custom_add(self, x, y):
                return x + y

            @jmespath.functions.signature(
                {'types': ['number']},
                {'types': ['number']})
            def _func_my_subtract(self, x, y):
                return x - y


        options = jmespath.Options(custom_functions=CustomFunctions())
        self.assertEqual(
            jmespath.search('custom_add(`1`, `2`)', {}, options=options),
            3
        )
        self.assertEqual(
            jmespath.search('my_subtract(`10`, `3`)', {}, options=options),
            7
        )
        # Should still be able to use the original functions without
        # any interference from the CustomFunctions class.
        self.assertEqual(
            jmespath.search('length(`[1, 2]`)', {}), 2
        )



class TestPythonSpecificCases(unittest.TestCase):
    def test_can_compare_strings(self):
        # This is python specific behavior that's not in the official spec
        # yet, but this was regression from 0.9.0 so it's been added back.
        self.assertTrue(jmespath.search('a < b', {'a': '2016', 'b': '2017'}))

    @unittest.skipIf(not hasattr(sys, 'maxint'), 'Test requires long() type')
    def test_can_handle_long_ints(self):
        result = sys.maxint + 1
        self.assertEqual(jmespath.search('[?a >= `1`].a', [{'a': result}]),
                         [result])

    def test_can_handle_decimals_as_numeric_type(self):
        result = decimal.Decimal('3')
        self.assertEqual(jmespath.search('[?a >= `1`].a', [{'a': result}]),
                         [result])


class TestFunctionsUseDictCls(unittest.TestCase):
    # Search data with a value of every JMESPath type, whose objects are all
    # OrderedDicts.  With dict_cls=OrderedDict, every object in the result of
    # any built-in function must then be an OrderedDict too.
    ARGUMENTS = {
        'object': 'obj', 'array': 'arr', 'string': 's', 'number': 'n',
        'boolean': 'b', 'null': 'z', 'array-number': 'nums',
        'array-string': 'strs', 'expref': '&k',
    }

    def _objects(self, value):
        if isinstance(value, dict):
            yield value
            for item in value.values():
                yield from self._objects(item)
        elif isinstance(value, list):
            for item in value:
                yield from self._objects(item)

    def test_every_function_builds_objects_of_dict_cls(self):
        data = OrderedDict([
            ('obj', OrderedDict([('k', 'a')])),
            ('arr', [OrderedDict([('k', 'a')]), OrderedDict([('k', 'b')])]),
            ('s', 'a'), ('n', 1), ('b', True), ('z', None),
            ('nums', [1, 2]), ('strs', ['a', 'b']),
        ])
        options = jmespath.Options(dict_cls=OrderedDict)
        failures = []
        table = jmespath.functions.Functions.FUNCTION_TABLE
        for name, spec in sorted(table.items()):
            args = [self.ARGUMENTS[a['types'][0]] if a['types'] else 'obj'
                    for a in spec['signature']]
            expression = '%s(%s)' % (name, ', '.join(args))
            try:
                result = jmespath.search(expression, data, options=options)
            except jmespath.exceptions.JMESPathError:
                continue
            if any(type(o) is not OrderedDict for o in self._objects(result)):
                failures.append(expression)
        self.assertEqual(failures, [])
