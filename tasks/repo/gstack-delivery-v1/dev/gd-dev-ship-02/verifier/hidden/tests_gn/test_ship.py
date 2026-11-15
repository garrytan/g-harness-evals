import pytest

import bottle


def test_order_and_form():
    assert bottle.html_attrs({'title': 'Hi', 'class_': 'btn', 'id': 'go'}) == ' title="Hi" class="btn" id="go"'
    assert bottle.html_attrs({}) == ''


@pytest.mark.parametrize("attrs, expected", [
    ({'class_': 'a'}, ' class="a"'),
    ({'data_user_id': 1}, ' data-user-id="1"'),
    ({'for_': 'x', 'aria_label': 'y'}, ' for="x" aria-label="y"'),
    ({'http_equiv__': 'refresh'}, ' http-equiv="refresh"'),
])
def test_names(attrs, expected):
    assert bottle.html_attrs(attrs) == expected


@pytest.mark.parametrize("attrs, expected", [
    ({'disabled': True}, ' disabled'),
    ({'disabled': False}, ''),
    ({'title': None}, ''),
    ({'checked': True, 'hidden': False, 'value': 'v', 'x': None}, ' checked value="v"'),
    ({'value': 0}, ' value="0"'),
    ({'value': ''}, ' value=""'),
])
def test_flags(attrs, expected):
    assert bottle.html_attrs(attrs) == expected


@pytest.mark.parametrize("attrs, expected", [
    ({'class_': ['btn', 'big']}, ' class="btn big"'),
    ({'class_': ('a', 1)}, ' class="a 1"'),
    ({'title': '"<x>" & \'y\''}, ' title="&quot;&lt;x&gt;&quot; &amp; &#039;y&#039;"'),
    ({'title': 'one\ntwo\tthree'}, ' title="one\ntwo\tthree"'),
    ({'value': 1.5}, ' value="1.5"'),
])
def test_values(attrs, expected):
    assert bottle.html_attrs(attrs) == expected


@pytest.mark.parametrize("name", ['on click', 'a"b', "a'b", 'a>b', 'a<b', 'a/b', 'a=b', 'a\tb', 'a\x00b', '_', ''])
def test_invalid_names(name):
    with pytest.raises(ValueError):
        bottle.html_attrs({name: 'x'})


def test_in_templates():
    assert bottle.template('<input{{!html_attrs(a)}}>', a={'type': 'checkbox', 'checked': False, 'name_': 'n'}) == '<input type="checkbox" name="n">'


def test_main_html_escape():
    assert bottle.html_escape('<\'"&>', quote=False) == '&lt;\'"&amp;&gt;'
    assert bottle.html_escape('<\'"&>') == '&lt;&#039;&quot;&amp;&gt;'
    assert bottle.html_escape(5) == '5'
    assert bottle.template('{{x}}', x='"<') == '&quot;&lt;'
