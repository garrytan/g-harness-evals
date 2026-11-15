import pytest

from more_itertools import iter_ranges


def test_the_default_limit():
    assert len(list(iter_ranges('1-10000'))) == 10000
    with pytest.raises(ValueError):
        list(iter_ranges('0-10000'))
