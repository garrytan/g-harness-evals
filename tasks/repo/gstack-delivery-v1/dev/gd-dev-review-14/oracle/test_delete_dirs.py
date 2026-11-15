from jmespath.library import QueryLibrary


def test_delete_keeps_the_root(tmp_path):
    root = tmp_path / 'lib'
    library = QueryLibrary(str(root))
    library.save('team/core/x', 'a')
    library.delete('team/core/x')
    assert root.is_dir()
    assert list(root.iterdir()) == []
