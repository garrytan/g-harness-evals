from inflection import pluralize_many


def test_pluralize_many_accepts_an_iterable():
    words = (word for word in ['person', 'sensor', 'sheep', ''])
    assert pluralize_many(words) == ['people', 'sensors', 'sheep', '']


def test_pluralize_many_custom_vocabulary():
    words = ['Telemetry', 'telemetry', 'sensor']
    assert pluralize_many(words, uncountables=['TELEMETRY']) == [
        'Telemetry', 'telemetry', 'sensors'
    ]
    assert words == ['Telemetry', 'telemetry', 'sensor']
