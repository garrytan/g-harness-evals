import pytest

from more_itertools import argmax, argmin


def test_default_on_empty_input():
    assert argmin([], default=None) is None
    assert argmax([], default='none') == 'none'
    assert argmin((), default=-1) == -1
    assert argmax([], default=0, last=True) == 0
    assert argmin([5], default=-1) == 0


def test_empty_input_without_default_raises():
    with pytest.raises(ValueError):
        argmin([])
    with pytest.raises(ValueError):
        argmax([], last=True)


@pytest.mark.parametrize('values, lo, hi', [
    ([3, 1, 2, 1], 3, 0),
    ([1, 3, 3, 2], 0, 2),
    ([2, 2, 2], 2, 2),
    ([5, 4, 9, 4, 9, 6], 3, 4),
    ('abcab', 3, 2),
    ([7], 0, 0),
])
def test_last(values, lo, hi):
    assert argmin(values, last=True) == lo
    assert argmax(values, last=True) == hi


@pytest.mark.parametrize('values, lo, hi', [
    ([3, 1, 2, 1], 1, 0),
    ([1, 3, 3, 2], 0, 1),
    ([2, 2, 2], 0, 0),
    ([5, 4, 9, 4, 9, 6], 1, 2),
])
def test_first_by_default(values, lo, hi):
    assert argmin(values) == lo
    assert argmax(values) == hi
    assert argmin(values, last=False) == lo
    assert argmax(values, last=False) == hi


def test_several_arguments():
    assert argmax(3, 9, 2) == 1
    assert argmin('b', 'a', 'c') == 1
    assert argmin(4, 1, 1) == 1
    assert argmin(4, 1, 1, last=True) == 2
    assert argmax(7, 7, last=True) == 1
    assert argmax(2, 8, 8, 1, last=True) == 2
