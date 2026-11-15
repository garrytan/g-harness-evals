import pytest

from tabulate.export import export_html


def test_a_name_cannot_leave_the_directory(tmp_path):
    out = tmp_path / "out"
    (out / "a").mkdir(parents=True)
    with pytest.raises(ValueError):
        export_html(str(out), {"a/../../escaped": [[1]]})
    assert not (tmp_path / "escaped.html").exists()
