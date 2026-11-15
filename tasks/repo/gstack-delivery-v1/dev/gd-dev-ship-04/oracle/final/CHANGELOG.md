# Changelog

## Unreleased

- Added: Daily and weekly jobs accept 12-hour times such as 7:30pm, converted by the new to_24_hour function. (feature/037a74)

## 1.3.0

- Added: Daily and weekly jobs accept a single-digit hour in at(), such as 9:30. (feature/4b8e21)
- Added: The schedule module lists its public API in __all__. (feature/7d20c5)

## 1.2.2

- Fixed: Jobs scheduled with until() and a time zone are cancelled on time.
