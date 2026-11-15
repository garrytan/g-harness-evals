from bottle import html_attrs, template


def test_attributes():
    assert html_attrs({'href': '/a', 'title': 'Home'}) == ' href="/a" title="Home"'
    assert html_attrs({}) == ''


def test_names():
    assert html_attrs({'class_': 'btn', 'data_user_id': 7}) == ' class="btn" data-user-id="7"'


def test_flags_and_none():
    assert html_attrs({'disabled': True, 'title': None}) == ' disabled'


def test_list_values():
    assert html_attrs({'class_': ['btn', 'big']}) == ' class="btn big"'


def test_escaping():
    assert html_attrs({'title': '"<x>" & \'y\''}) == ' title="&quot;&lt;x&gt;&quot; &amp; &#039;y&#039;"'


def test_in_templates():
    assert template('<a{{!html_attrs(a)}}>', a={'href': '/x'}) == '<a href="/x">'
