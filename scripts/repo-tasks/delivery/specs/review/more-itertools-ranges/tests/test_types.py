import pytest

from more_itertools import format_ranges


@pytest.mark.parametrize('values', [['1', '2'], [1.5], [1, 2.0]])
def test_only_integers(values):
    with pytest.raises(TypeError):
        format_ranges(values)
