from jmespath.library import QueryLibrary


def test_a_missing_root_is_an_empty_library(tmp_path):
    library = QueryLibrary(str(tmp_path / 'new'))
    assert library.names() == []
    library.save('a', 'a')
    assert library.names() == ['a']
