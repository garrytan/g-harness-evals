# validators.ip_address private kwarg does not work as intended

Python: `3.12` 
Valdiators: `0.28.1`

`validators.ip_address` does not properly handle the scenario when `private=False`

Result: 

```
❯ python3.11
iPython 3.11.7 (main, Dec  4 2023, 18:10:11) [Clang 15.0.0 (clang-1500.1.0.2.5)] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> import validators
>>> a = "1.1.1.1"
>>> validators.ipv4(a)
True
>>> validators.ipv4(a, private=True)
ValidationError(func=ipv4, args={'value': '1.1.1.1', 'private': True})
>>> validators.ipv4(a, private=False)
ValidationError(func=ipv4, args={'value': '1.1.1.1', 'private': False})
```

Expected Result:
```
❯ python3.11
iPython 3.11.7 (main, Dec  4 2023, 18:10:11) [Clang 15.0.0 (clang-1500.1.0.2.5)] on darwin
Type "help", "copyright", "credits" or "license" for more information.
>>> import validators
>>> a = "1.1.1.1"
>>> validators.ipv4(a)
True
>>> validators.ipv4(a, private=True)
ValidationError(func=ipv4, args={'value': '1.1.1.1', 'private': True})
>>> validators.ipv4(a, private=False)
True
```

I also noticed there are no unit tests that cover the above scenarios.
