import pytest

import schedule
from schedule.history import RunHistory


@pytest.mark.parametrize("table", ["runs (id)", "runs--", "runs; x"])
def test_table_must_be_a_plain_identifier(tmp_path, table):
    with pytest.raises(schedule.ScheduleValueError):
        RunHistory(str(tmp_path / "runs.db"), table=table)
