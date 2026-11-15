from jmespath.library import QueryLibrary


def test_reading_a_new_library_creates_nothing(tmp_path):
    root = tmp_path / 'new'
    library = QueryLibrary(str(root))
    assert library.names() == []
    assert not root.exists()
