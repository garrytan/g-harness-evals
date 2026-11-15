import os

import pytest

from jmespath.library import QueryLibrary


def test_a_failed_write_leaves_no_temporary_file(tmp_path):
    library = QueryLibrary(str(tmp_path))
    library.save('x', 'a')
    with pytest.raises(UnicodeEncodeError):
        library.save('x', "'\ud800'")
    assert sorted(os.listdir(str(tmp_path))) == ['x.jmespath']
    assert QueryLibrary(str(tmp_path)).search('x', {'a': 1}) == 1
