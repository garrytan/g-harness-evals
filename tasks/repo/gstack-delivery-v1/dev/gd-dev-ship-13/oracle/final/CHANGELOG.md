# Changelog

## Unreleased

- Added: Acronym support: acronym() registers an acronym that camelize, underscore, humanize and titleize keep spelled as registered. (feature/8d08a8)

## 0.6.0

- Changed: camelize lowercases the rest of each word, like Rails, so DEVICE_type becomes DeviceType. (feature/c4d21b)
- Added: __all__ lists the public functions, so from inflection import * brings in only those. (feature/7e2a90)

## 0.5.1

- Fixed: Type hints for every public function.
