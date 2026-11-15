from jmespath.library import QueryLibrary


def test_a_hash_inside_a_string_literal(tmp_path):
    library = QueryLibrary(str(tmp_path))
    library.save('tagged', "[?tag == '#1'].id")
    data = [{'tag': '#1', 'id': 'a'}, {'tag': '#2', 'id': 'b'}]
    assert QueryLibrary(str(tmp_path)).search('tagged', data) == ['a']
