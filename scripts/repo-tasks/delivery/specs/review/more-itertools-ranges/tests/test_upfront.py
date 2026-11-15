import pytest

from more_itertools import iter_ranges


def test_a_bad_spec_produces_nothing():
    produced = []
    with pytest.raises(ValueError):
        for n in iter_ranges('1-3,x'):
            produced.append(n)
    assert produced == []

    with pytest.raises(ValueError):
        iter_ranges('1-3,x')
