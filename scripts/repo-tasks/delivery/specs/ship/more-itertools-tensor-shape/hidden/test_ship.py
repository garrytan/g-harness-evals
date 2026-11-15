import pytest

from more_itertools import shape
from more_itertools.recipes import _is_array


@pytest.mark.parametrize('tensor, expected', [
    ([[1, 2, 3], [4, 5, 6]], (2, 3)),
    ([(1, 2), (3, 4), (5, 6)], (3, 2)),
    ([1, 2], (2,)),
    (7, ()),
    (None, ()),
    ([[[1], [2]], [[3], [4]]], (2, 2, 1)),
    (((1, 2, 3, 4),), (1, 4)),
])
def test_dimensions(tensor, expected):
    assert shape(tensor) == expected


@pytest.mark.parametrize('tensor, expected', [
    ('abc', ()),
    (['ab', 'cd'], (2,)),
    ([b'ab', b'cd'], (2,)),
    ([{'a': 1}, {'b': 2}], (2,)),
    ({'a': [1, 2]}, ()),
    ([[{'a': 1}], [{}]], (2, 1)),
])
def test_scalars(tensor, expected):
    assert shape(tensor) == expected


@pytest.mark.parametrize('tensor', [
    [[1, 2], [3]],
    [[[1, 2], [3, 4]], [[5, 6], [7]]],
    [[], [1]],
])
def test_ragged(tensor):
    with pytest.raises(ValueError):
        shape(tensor)


@pytest.mark.parametrize('tensor', [
    [[1, 2], 3],
    [1, [2, 3]],
    [[1], [[2]]],
    [[[1]], [2]],
    ['ab', ['c']],
    [{'a': 1}, [1]],
])
def test_mixed(tensor):
    with pytest.raises(ValueError):
        shape(tensor)


def test_empty():
    assert shape([]) == (0,)
    assert shape([[], []]) == (2, 0)
    assert shape(()) == (0,)


def test_main_scalar_rule_still_holds():
    assert _is_array([1]) is True
    assert _is_array({'a': 1}) is False
    assert _is_array('ab') is False
    assert _is_array(3) is False
