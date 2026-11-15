import pytest

from jmespath.library import InvalidQueryNameError, QueryLibrary


def test_a_sibling_directory_with_the_same_prefix_is_outside(tmp_path):
    (tmp_path / 'queries-private').mkdir()
    (tmp_path / 'queries-private' / 'secret.jmespath').write_text('token\n')
    library = QueryLibrary(str(tmp_path / 'queries'))
    with pytest.raises(InvalidQueryNameError):
        library.get('../queries-private/secret')
