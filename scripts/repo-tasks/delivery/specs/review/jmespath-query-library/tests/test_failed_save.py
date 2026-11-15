import pytest

from jmespath import exceptions
from jmespath.library import QueryLibrary


def test_a_failed_save_keeps_the_saved_query(tmp_path):
    library = QueryLibrary(str(tmp_path))
    library.save('x', 'a.b')
    with pytest.raises(exceptions.ParseError):
        library.save('x', 'a.[')
    assert QueryLibrary(str(tmp_path)).search('x', {'a': {'b': 1}}) == 1
