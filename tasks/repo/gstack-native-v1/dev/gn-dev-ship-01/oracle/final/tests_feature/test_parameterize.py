from inflection import parameterize


def test_parameterize_preserves_case_when_requested():
    assert parameterize('Donald E. Knuth', preserve_case=True) == 'Donald-E-Knuth'


def test_parameterize_lowercases_by_default():
    assert parameterize('Donald E. Knuth') == 'donald-e-knuth'
