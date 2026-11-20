# Python `funcutils.wraps` breaks when keyword only arguments involved

Code worth 1000 words:

```python
>>> from boltons.funcutils import wraps
>>>
>>> def g(a: float, b=10):
...     return a * b
>>>
>>> def f(a: int,  *, b=1):
...     return a * b
>>>
>>> # all is well here...
>>> assert f(3) == 3
>>> assert g(3) == 30
>>> assert wraps(f)(g)(3) == 3  # yay, g got the f default (not so with functools.wraps!)
>>>
>>> # but this doesn't work
>>> wraps(g)(f)(3)
Traceback (most recent call last):
  File "<stdin>", line 1, in <module>
  File "<boltons.funcutils.FunctionBuilder-1>", line 2, in g
TypeError: f() takes 1 positional argument but 2 were given
```
