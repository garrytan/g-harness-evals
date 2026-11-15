# Changelog

## Unreleased

- Added: A group_by function that groups the elements of an array by a string key. (feature/b16903)

## 1.2.0

- Fixed: min_by and max_by raise JMESPathTypeError, not TypeError, when the keys mix numbers and strings. (feature/0b71e4)
- Fixed: merge() builds its result with the dict_cls given in Options, like the rest of a search. (feature/2e6f48)

## 1.1.0

- Added: Python 3.14 support.
