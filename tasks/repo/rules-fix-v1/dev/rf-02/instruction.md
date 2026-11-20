# URL.navigate fails with path in base URL

The following and several permutations fail attempting to concatenate a `tuple` with a `list`:

```
URL('http://localhost').navigate('a').navigate('b')
```
Result:

```
...
            else:  # relative path
>               new_path_parts = list(self.path_parts[:-1]) + dest.path_parts
E               TypeError: can only concatenate list (not "tuple") to list

boltons/urlutils.py:657: TypeError
```

I am a little unclear about exactly what *should* happen when 'a' has a trailing slash or not, but enough cases fail that I know *something* is wrong.
I will follow shortly with a PR with a number of test cases, some of which I know are wrong, so I am hoping I can get some clarification about what the correct behavior *should* be.

This is not strictly an issue with chaining the `navigate` calls, but rather ambiguity of what should happen with the base URL lacks a trailing '/' and failures that result from that.

Env data:
platform darwin
Python 3.6.5 (built w/pyenv)
pytest-3.5.1

Fix this issue in /work/repo.
