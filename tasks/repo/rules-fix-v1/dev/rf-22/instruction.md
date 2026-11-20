# Bug: `intfmt` error for strings which contain integer values

# Bug: `intfmt` error for strings which contain integer values

## Description

The argument `intfmt` throws an error when some value in the data is a string, but it looks like an integer. For example: the string value “1234” is considering for the `_format` function as an integer, but it is a string.

## Examples

Works:
`print(tabulate([["a", 9200], ["b", 90000]], intfmt=","))`

Not works:
`print(tabulate([("1", 9200), ("2", 90000)], intfmt=","))`

Works, but not the optimal solution when have plenty of data:
`print(tabulate([("1", 9200), ("2", 90000)], intfmt=("", ",")))`

## Error

```
Traceback (most recent call last):
  File "…/main.py", line 58, in <module>
    main()
  File "…/main.py", line 40, in main
    print(tabulate([("1", 9200), ("2", 90000)], intfmt=","))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "…/python3.11/site-packages/tabulate/__init__.py", line 2156, in tabulate
    cols = [
           ^
  File "…/python3.11/site-packages/tabulate/__init__.py", line 2157, in <listcomp>
    [_format(v, ct, fl_fmt, int_fmt, miss_v, has_invisible) for v in c]
  File "…/python3.11/site-packages/tabulate/__init__.py", line 2157, in <listcomp>
    [_format(v, ct, fl_fmt, int_fmt, miss_v, has_invisible) for v in c]
     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "…/python3.11/site-packages/tabulate/__init__.py", line 1222, in _format
    return format(val, intfmt)
           ^^^^^^^^^^^^^^^^^^^
ValueError: Cannot specify ',' with 's'.
```

## Debugging

I added the follow prints to debug the error.

```python
def _format(val, valtype, floatfmt, intfmt, missingval="", has_invisible=True):
    """
    …
    """  # noqa
    print("_format(val, valtype, …) | Line #1201")
    print(f'val: {val} ({type(val)})')
    print(f'valtype: {valtype}')
    if val is None:
        return missingval
```

### When it works

`print(tabulate([["a", 9200], ["b", 90000]], intfmt=","))`

```
_format(val, valtype, …) | Line #1201
val: a (<class 'str'>)
valtype: <class 'str'>

_format(val, valtype, …) | Line #1201
val: b (<class 'str'>)
valtype: <class 'str'>

_format(val, valtype, …) | Line #1201
val: 9200 (<class 'int'>)
valtype: <class 'int'>

_format(val, valtype, …) | Line #1201
val: 90000 (<class 'int'>)
valtype: <class 'int'>

-  ------
a   9,200
b  90,000
-  ------
```

### When it doesn't work

`print(tabulate([("1", 9200), ("2", 90000)], intfmt=","))`

```
_format(val, valtype, …) | Line #1201
val: 1 (<class 'str'>)
valtype: <class 'int'>
```

**Noticed** that the `val` argument is a string, but the `valtype` is an integer. So, if it tries to execute the:
```python
return format(val, intfmt)
```
It will throw an error because it is a string trying to format as an integer.

Fix this issue in /work/repo.
