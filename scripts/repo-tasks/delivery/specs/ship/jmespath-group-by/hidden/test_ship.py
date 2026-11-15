import pytest

import jmespath


PEOPLE = [
    {'name': 'a', 'team': 'core', 'age': 30},
    {'name': 'b', 'team': 'web', 'age': 25},
    {'name': 'c', 'team': 'core', 'age': 41},
    {'name': 'd', 'age': 19},
    {'name': 'e', 'team': None, 'age': 52},
]


def _error(expression, data):
    with pytest.raises(Exception) as e:
        jmespath.search(expression, data)
    return type(e.value).__name__


def test_groups_in_original_order():
    assert jmespath.search('group_by(@, &team)', PEOPLE[:3]) == {
        'core': [PEOPLE[0], PEOPLE[2]], 'web': [PEOPLE[1]]}
    assert jmespath.search('keys(group_by(@, &team))', PEOPLE[1:3]) == ['web', 'core']
    assert jmespath.search('group_by(@, &team).core[].name', PEOPLE) == ['a', 'c']


def test_null_keys_are_left_out():
    assert jmespath.search('group_by(@, &team)', PEOPLE) == {
        'core': [PEOPLE[0], PEOPLE[2]], 'web': [PEOPLE[1]]}
    assert jmespath.search('group_by(@, &team)', [{'team': None}, {}]) == {}


def test_empty_array_gives_an_empty_object():
    assert jmespath.search('group_by(@, &team)', []) == {}
    assert jmespath.search('length(group_by(@, &team))', []) == 0


@pytest.mark.parametrize('data', [
    [{'k': 1}],
    [{'k': 'a'}, {'k': 2}],
    [{'k': True}],
    [{'k': ['a']}],
    [{'k': {'a': 1}}],
])
def test_other_key_types_are_type_errors(data):
    assert _error('group_by(@, &k)', data) == 'JMESPathTypeError'


@pytest.mark.parametrize('data', ['abc', {'a': 1}, 5])
def test_first_argument_must_be_an_array(data):
    assert _error('group_by(@, &k)', data) == 'JMESPathTypeError'


def test_main_mixed_key_types_are_type_errors():
    data = [{'v': 1}, {'v': 'x'}]
    assert _error('max_by(@, &v)', data) == 'JMESPathTypeError'
    assert _error('min_by(@, &v)', data) == 'JMESPathTypeError'
    assert _error('sort_by(@, &v)', data) == 'JMESPathTypeError'


def test_main_by_functions_still_work():
    assert jmespath.search('max_by(@, &age).name', PEOPLE) == 'e'
    assert jmespath.search('min_by(@, &name).name', PEOPLE) == 'a'
    assert jmespath.search('sort_by(@, &age)[].name', PEOPLE) == ['d', 'b', 'a', 'c', 'e']
    assert jmespath.search('max_by(@, &age)', []) is None
