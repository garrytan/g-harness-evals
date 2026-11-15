import pytest

from tabulate.export import export_html


def test_a_name_cannot_hold_markup(tmp_path):
    with pytest.raises(ValueError):
        export_html(str(tmp_path), {"<img src=x onerror=alert(1)>": [[1]]})
