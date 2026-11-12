# Weekend project options

You have Rust to learn, a Pi 4 and an SDR dongle in a drawer, and two hobbies with real data in them. Here are five directions that are not habit trackers.

## 1. Weather station decoder

Use the SDR dongle to pick up the 433 MHz weather stations in nearby gardens (via rtl_433), parse them in Rust on the Pi, store readings in SQLite and compare wind and pressure with your bird sightings.

- Rust you'd learn: serde, async IO, SQLite bindings.
- Size: about a month of weekends.
- Risk: the nearest station may be out of range.

## 2. Aircraft tracker

Decode ADS-B from planes overhead with the dongle and draw a live map in the terminal.

- Rust you'd learn: binary parsing, a TUI library.
- Size: a few weekends.
- Risk: well-trodden; plenty of existing tools.

## 3. Digital bird log

Type up the paper notebook into a small Rust CLI that answers questions like "when did I first see a lapwing each year?"

- Rust you'd learn: CSV, CLI argument parsing.
- Size: one or two weekends.
- Risk: data entry is the boring part.

## 4. Valve radio retrofit

Put the Pi inside a restored radio case and use the original tuning dial (with a rotary encoder) to switch between internet radio stations.

- Rust you'd learn: GPIO, audio playback.
- Size: a month; a lot of it is woodwork.
- Risk: more hardware than Rust.

## 5. Radio parts price watcher

Scrape auction listings for valve radio parts and send a weekly digest.

- Rust you'd learn: HTTP clients, HTML parsing.
- Size: a weekend.
- Risk: sites block scrapers.

## My pick

Start with **option 1, the weather station decoder**. It uses hardware you already own, joins both hobbies with real data, and teaches the Rust you'd use at work. First step: run `rtl_433 -F json` for an evening and see how many stations you can hear.
