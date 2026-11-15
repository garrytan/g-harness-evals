import pytest

from more_itertools import iter_ranges


@pytest.mark.parametrize('limit', [2.5, '10', 10.0])
def test_the_limit_must_be_an_integer(limit):
    with pytest.raises(TypeError):
        list(iter_ranges('1-2', limit=limit))
