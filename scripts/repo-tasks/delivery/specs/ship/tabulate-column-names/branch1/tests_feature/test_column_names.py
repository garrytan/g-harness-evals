from tabulate import tabulate


def test_floatfmt_by_name():
    table = tabulate([["spam", 41.9999, 3.14159]], headers=["item", "qty", "price"], floatfmt={"price": ".2f"})
    assert table == "item        qty    price\n------  -------  -------\nspam    41.9999     3.14"


def test_colalign_by_name():
    table = tabulate([["spam", 41.9999]], headers=["item", "qty"], colalign={"qty": "left"})
    assert table == "item    qty\n------  -------\nspam    41.9999"


def test_missingval_by_name():
    table = tabulate([["a", None, None]], headers=["x", "y", "z"], missingval={"z": "?"})
    assert table == "x    y    z\n---  ---  ---\na         ?"


def test_intfmt_by_name():
    table = tabulate([["a", 1234567]], headers=["x", "n"], intfmt={"n": ","})
    assert table == "x            n\n---  ---------\na    1,234,567"


def test_maxcolwidths_by_name():
    table = tabulate([["aaaa bbbb", "cccc dddd"]], headers=["x", "y"], maxcolwidths={"y": 4})
    assert table == "x          y\n---------  ----\naaaa bbbb  cccc\n           dddd"


def test_headers_from_keys():
    table = tabulate([{"a": 1.23456, "b": 2.5}], headers="keys", floatfmt={"b": ".3f"})
    assert table == "      a      b\n-------  -----\n1.23456  2.500"
