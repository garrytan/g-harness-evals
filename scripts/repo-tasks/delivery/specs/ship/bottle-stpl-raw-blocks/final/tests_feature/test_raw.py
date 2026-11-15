from bottle import template


def test_raw_block():
    assert template('a\n% raw\n{{x}} <b>\n% endraw\nb {{x}}', x=1) == 'a\n{{x}} <b>\nb 1'


def test_code_lines_in_raw_block():
    assert template('% raw\n% for i in range(3):\n{{i}}\n% end\n% endraw\n') == '% for i in range(3):\n{{i}}\n% end\n'


def test_indented_raw_block():
    assert template('% if True:\n  % raw\n  {{x}}\n  % endraw\n% end\n') == '  {{x}}\n'
