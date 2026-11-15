import pytest

from more_itertools import iter_ranges


@pytest.mark.parametrize('spec', ['\u0663', '\uff11-\uff13', '1-\u0665'])
def test_only_ascii_digits(spec):
    with pytest.raises(ValueError):
        list(iter_ranges(spec))
