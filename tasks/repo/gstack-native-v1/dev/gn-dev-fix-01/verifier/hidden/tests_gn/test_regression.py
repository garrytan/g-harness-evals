import pytest
from tabulate import tabulate


@pytest.mark.parametrize("value", [42, True, 2.5])
def test_mixed_bytes_column_formats_non_bytes_values(value):
    result = tabulate([[b"item"], [value]], tablefmt="plain")
    assert [line.strip() for line in result.splitlines()] == ["item", str(value)]
