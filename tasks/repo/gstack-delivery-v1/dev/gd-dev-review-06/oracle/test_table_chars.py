import pytest

import schedule
from schedule.history import RunHistory


@pytest.mark.parametrize("table", ["[runs]", "`runs`", "^runs", "\\runs"])
def test_table_may_only_use_letters_digits_and_underscores(tmp_path, table):
    with pytest.raises(schedule.ScheduleValueError):
        RunHistory(str(tmp_path / "runs.db"), table=table)
