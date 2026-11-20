# TypeError when using a tuple for maxcolwidths

Good:

```pycon
In [10]: print(t.tabulate([["lorem ipsum dolor sit amet"]*3], tablefmt="grid", maxcolwidths=[12, 8]))
+-------------+----------+----------------------------+
| lorem ipsum | lorem    | lorem ipsum dolor sit amet |
| dolor sit   | ipsum    |                            |
| amet        | dolor    |                            |
|             | sit amet |                            |
+-------------+----------+----------------------------+
```

Bad:

```pycon
In [11]: print(t.tabulate([["lorem ipsum dolor sit amet"]*3], tablefmt="grid", maxcolwidths=(12, 8)))
---------------------------------------------------------------------------
TypeError                                 Traceback (most recent call last)
Input In [11], in <cell line: 1>()
----> 1 print(t.tabulate([["lorem ipsum dolor sit amet"]*3], tablefmt="grid", maxcolwidths=(12, 8)))

File ~\AppData\Local\Programs\Python\Python39\lib\site-packages\tabulate\__init__.py:2058, in tabulate(tabular_data, headers, tablefmt, floatfmt, intfmt, numalign, stralign, missingval, showindex, disable_numparse, colalign, maxcolwidths, rowalign, maxheadercolwidths)
   2056     maxcolwidths = _expand_iterable(maxcolwidths, num_cols, maxcolwidths)
   2057 else:  # Ignore col width for any 'trailing' columns
-> 2058     maxcolwidths = _expand_iterable(maxcolwidths, num_cols, None)
   2060 numparses = _expand_numparse(disable_numparse, num_cols)
   2061 list_of_lists = _wrap_text_to_colwidths(
   2062     list_of_lists, maxcolwidths, numparses=numparses
   2063 )

File ~\AppData\Local\Programs\Python\Python39\lib\site-packages\tabulate\__init__.py:2229, in _expand_iterable(original, num_desired, default)
   2221 """
   2222 Expands the `original` argument to return a return a list of
   2223 length `num_desired`. If `original` is shorter than `num_desired`, it will
   (...)
   2226 length `num_desired` completely populated with `default will be returned
   2227 """
   2228 if isinstance(original, Iterable) and not isinstance(original, str):
-> 2229     return original + [default] * (num_desired - len(original))
   2230 else:
   2231     return [default] * num_desired

TypeError: can only concatenate tuple (not "list") to tuple
```

v0.9.0. Python 3.9.

Fix this issue in /work/repo.
