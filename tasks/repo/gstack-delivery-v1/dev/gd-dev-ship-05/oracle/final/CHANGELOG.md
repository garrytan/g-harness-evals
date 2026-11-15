# Changelog

## Unreleased

- Added: The lower, upper, trim and split string functions. (feature/f40b6d)

## 1.2.0

- Changed: Function arity is worked out once, when the function table is built. (feature/7c2a90)
- Fixed: Every argument of a variadic function is type checked, so merge() with a non-object argument raises JMESPathTypeError. (feature/e4d815)
- Fixed: contains() with a string subject and a search value that is not a string returns false instead of raising a Python TypeError. (feature/5b9d13)

## 1.1.0

- Added: Python 3.14 support.
