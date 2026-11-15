# Changelog

## Unreleased

- Added: parse_spec reads a schedule written as text, such as "every 10 minutes", into the settings of the job it describes. (feature/79a636)

## 1.3.0

- Added: Job.on() schedules a weekly job on a weekday given by name, in any case and in full or as its first three letters. (feature/7e1c0a)

## 1.2.2

- Fixed: Jobs scheduled with until() and a time zone are cancelled on time.
