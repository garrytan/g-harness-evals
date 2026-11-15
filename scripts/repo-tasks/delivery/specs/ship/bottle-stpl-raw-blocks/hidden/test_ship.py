import pytest

import bottle


def test_raw_block_is_written_as_it_is():
    source = 'a\n% raw\n{{x}} and {{!y}}\n% if z:\n<%\nq = 1\n%>\n% endraw\nb {{x}}'
    assert bottle.template(source, x=1) == 'a\n{{x}} and {{!y}}\n% if z:\n<%\nq = 1\n%>\nb 1'


@pytest.mark.parametrize("source, settings, expected", [
    ('  % raw\n{{a}}\n  % endraw\nx', {}, '{{a}}\nx'),
    ('%raw\n{{a}}\n%endraw\nx', {}, '{{a}}\nx'),
    ('% raw \t\n{{a}}\n\t%   endraw  \nx', {}, '{{a}}\nx'),
    ('% raw\n\n{{a}}\n\n% endraw\nx', {}, '\n{{a}}\n\nx'),
    ('% raw\n{{a}}\n% endraw', {}, '{{a}}\n'),
    ('% raw\n% endraw\nx', {}, 'x'),
    ('$ raw\n{{a}} %\n% endraw\n$ endraw\n{{b}}', {'syntax': '<% %> $ {{ }}'}, '{{a}} %\n% endraw\n2'),
    ('$raw\n<% x %>\n$endraw\n', {'syntax': '<% %> $ {{ }}'}, '<% x %>\n'),
])
def test_raw_and_endraw_lines(source, settings, expected):
    assert bottle.template(source, template_settings=settings, b=2) == expected


@pytest.mark.parametrize("show, expected", [(True, 'a\n{{x}}\nb'), (False, 'a\nb')])
def test_raw_block_inside_a_code_block(show, expected):
    assert bottle.template('a\n% if show:\n% raw\n{{x}}\n% endraw\n% end\nb', show=show) == expected


@pytest.mark.parametrize("source, expected", [
    ('% raw_html = "<b>"\n{{!raw_html}}', '<b>'),
    ('% raw = 5\n{{raw}}', '5'),
    ('% rawest = 1\n{{rawest}}!', '1!'),
    ('%raw_value=2\n{{raw_value}}', '2'),
])
def test_other_code_lines_starting_with_raw(source, expected):
    assert bottle.template(source) == expected


@pytest.mark.parametrize("source", [
    'a\n% raw\n{{x}}\n',
    '% raw\n',
    '% raw',
    '% raw\n% end raw\n',
])
def test_unclosed_raw_block(source):
    with pytest.raises(Exception) as info:
        bottle.template(source, x=1)
    assert type(info.value).__name__ == 'StplSyntaxError'


def test_main_template_output():
    assert bottle.template('<{{x}}|{{!x}}>\n% for i in range(2):\n{{i}}\n% end\n', x='<') == '<&lt;|<>\n0\n1\n'
    with pytest.raises(Exception) as info:
        bottle.template('a{{ }}b')
    assert type(info.value).__name__ == 'StplSyntaxError'
