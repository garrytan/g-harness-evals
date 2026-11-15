import pytest

from tabulate.export import export_html


def test_an_invalid_name_writes_nothing(tmp_path):
    out = tmp_path / "out"
    with pytest.raises(ValueError):
        export_html(str(out), {"good": [[1]], "../bad": [[2]]})
    assert not out.exists()
