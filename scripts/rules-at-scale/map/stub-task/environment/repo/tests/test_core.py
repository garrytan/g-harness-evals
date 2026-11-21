from stubpkg import clamp


def test_inside():
    assert clamp(5, 0, 10) == 5


def test_above():
    assert clamp(15, 0, 10) == 10
