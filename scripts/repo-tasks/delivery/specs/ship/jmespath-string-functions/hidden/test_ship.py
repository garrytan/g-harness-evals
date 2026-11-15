import pytest

import jmespath


def _error(expression, data):
    with pytest.raises(Exception) as e:
        jmespath.search(expression, data)
    return type(e.value).__name__


@pytest.mark.parametrize('expression, data, expected', [
    ('lower(@)', 'MiXed Ä', 'mixed ä'),
    ('upper(@)', 'MiXed ä', 'MIXED Ä'),
    ('lower(@)', '', ''),
    ('people[].upper(name)', {'people': [{'name': 'a'}, {'name': 'b'}]}, ['A', 'B']),
])
def test_lower_and_upper(expression, data, expected):
    assert jmespath.search(expression, data) == expected


@pytest.mark.parametrize('expression, data, expected', [
    ('trim(@)', ' \t padded \n', 'padded'),
    ('trim(@)', 'inner  space', 'inner  space'),
    ("trim(@, 'x')", 'xxaxbxx', 'axb'),
    ("trim(@, '-_')", '-_a_-', 'a'),
    ("trim(@, '')", '  a  ', 'a'),
    ("trim(@, '')", '\ta\n', 'a'),
    ("trim(@, 'x')", '  xa  ', '  xa  '),
])
def test_trim(expression, data, expected):
    assert jmespath.search(expression, data) == expected


@pytest.mark.parametrize('expression, data, expected', [
    ("split(@, ',')", 'a,b,,c', ['a', 'b', '', 'c']),
    ("split(@, ', ')", 'a, b', ['a', 'b']),
    ("split(@, ';')", 'abc', ['abc']),
    ("split(@, ',', `1`)", 'a,b,c', ['a', 'b,c']),
    ("split(@, ',', `0`)", 'a,b,c', ['a,b,c']),
    ("split(@, ',', `5`)", 'a,b', ['a', 'b']),
    ("split(@, '')", 'abc', ['a', 'b', 'c']),
    ("split(@, '', `1`)", 'abc', ['a', 'bc']),
    ("split(@, '', `0`)", 'abc', ['abc']),
    ("split(@, '', `5`)", 'ab', ['a', 'b']),
])
def test_split(expression, data, expected):
    assert jmespath.search(expression, data) == expected


@pytest.mark.parametrize('expression', [
    'lower()', "lower(@, 'a')", 'upper()', 'trim()', "trim(@, 'a', 'b')",
    'split(@)', "split(@, ',', `1`, `2`)",
])
def test_wrong_number_of_arguments(expression):
    assert _error(expression, 'abc') == 'ArityError'


@pytest.mark.parametrize('expression, data', [
    ('lower(@)', 5),
    ('upper(@)', None),
    ("trim(@, `1`)", 'a'),
    ('trim(@)', ['a']),
    ("split(@, ',')", 5),
    ("split(@, `1`)", 'a'),
    ("split(@, ',', 'x')", 'a,b'),
])
def test_wrong_argument_types(expression, data):
    assert _error(expression, data) == 'JMESPathTypeError'


def test_main_variadic_arguments_are_type_checked():
    assert _error("merge(`{}`, 'x')", {}) == 'JMESPathTypeError'
    assert _error("merge(`{}`, `{}`, `[1]`)", {}) == 'JMESPathTypeError'
    assert jmespath.search('merge(a, b, c)', {'a': {'x': 1}, 'b': {'y': 2}, 'c': {'x': 3}}) == {'x': 3, 'y': 2}
    assert jmespath.search('not_null(a, b, `3`)', {'b': 2}) == 2


def test_main_arity_errors_still_work():
    assert _error('not_null()', {}) == 'VariadictArityError'
    assert _error('merge()', {}) == 'VariadictArityError'
    assert _error('length(@, @)', []) == 'ArityError'
    assert _error('sort_by(@)', []) == 'ArityError'
    assert jmespath.search('length(@)', [1, 2]) == 2
