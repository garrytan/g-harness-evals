import pytest

from tabulate.sql import write_sql


def test_failed_conversion_leaves_the_file_alone(tmp_path):
    path = tmp_path / "out.sql"
    path.write_text("keep\n")
    with pytest.raises(ValueError):
        write_sql(str(path), [[1, 2]], "t", headers=["a"])
    assert path.read_text() == "keep\n"
