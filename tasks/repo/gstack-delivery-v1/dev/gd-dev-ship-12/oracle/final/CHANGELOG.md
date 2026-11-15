# Changelog

## Unreleased

- Added: A to_identifier function that turns arbitrary text into a snake_case or CamelCase Python identifier. (feature/f1e463)

## 0.6.0

- Changed: transliterate replaces a character it cannot approximate with a replacement string, '?' by default, like Rails. parameterize still drops them. (feature/e07a3f)
- Changed: A ValueError from a public function now starts with the function's name, such as ordinal() for input that is not a whole number. (feature/5c2d90)

## 0.5.1

- Fixed: Type hints for every public function.
