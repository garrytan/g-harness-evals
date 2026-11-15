import os
import tempfile

from jmespath.library import QueryLibrary


def test_listing_leaves_a_save_in_progress_alone(tmp_path):
    library = QueryLibrary(str(tmp_path))
    library.save('x', 'a')
    fd, tmp = tempfile.mkstemp(dir=str(tmp_path), prefix='.', suffix='.tmp')
    os.close(fd)
    assert library.names() == ['x']
    assert os.path.exists(tmp)
