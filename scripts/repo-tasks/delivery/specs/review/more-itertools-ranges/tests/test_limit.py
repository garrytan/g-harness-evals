import pytest

from more_itertools import iter_ranges


def test_limit_counts_every_part():
    with pytest.raises(ValueError):
        list(iter_ranges('1-6000,6001-12000'))
    with pytest.raises(ValueError):
        list(iter_ranges('1-3,4-6', limit=5))
    assert list(iter_ranges('1-3,4-5', limit=5)) == [1, 2, 3, 4, 5]
