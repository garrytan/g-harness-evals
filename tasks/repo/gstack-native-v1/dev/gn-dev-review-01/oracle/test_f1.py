import inflection


def test_batch_vocabulary_is_local(monkeypatch):
    baseline = inflection.UNCOUNTABLES.copy()
    baseline.discard('sensor')
    monkeypatch.setattr(inflection, 'UNCOUNTABLES', baseline.copy())

    assert inflection.pluralize_many(
        ['Sensor'], uncountables=['SENSOR']
    ) == ['Sensor']
    assert inflection.pluralize_many(['sensor']) == ['sensors']
    assert inflection.pluralize('sensor') == 'sensors'
    assert inflection.UNCOUNTABLES == baseline
