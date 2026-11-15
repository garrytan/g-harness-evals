# Changelog

## Unreleased

- Added: Public plural, singular, irregular and uncountable functions for adding inflection rules at runtime. (feature/3a9dd9)

## 0.6.0

- Added: `__all__` lists the public functions, so `from inflection import *` imports only those. (feature/c3f58a)
- Added: The irregular noun goose. (feature/2b7d10)
- Changed: The rule tables hold compiled patterns, so pluralize and singularize no longer compile a pattern on every call. (feature/91c4ae)

## 0.5.1

- Fixed: Type hints for every public function.
