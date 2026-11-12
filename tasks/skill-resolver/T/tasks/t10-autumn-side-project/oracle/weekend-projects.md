# Weekend project directions

**Method:** Lateral Provocations, Edward de Bono's PO operator. "Habit tracker" is high-slop terrain, so I broke the frame with provocations instead of brainstorming, and refused the first five ideas.

## Refused (the obvious five)

1. Another habit tracker, this time in Rust.
2. A bird sighting app to replace the paper notebook.
3. A Rust command-line todo list.
4. An inventory app for the radio collection.
5. A Grafana dashboard for the Pi.

## Directions

### 1. Po: the weather reports to you (Reversal)

**Marsh microclimate logger.** Your SDR dongle can hear the 433 MHz broadcasts from the cheap weather stations in nearby gardens. A Rust service on the Pi decodes rtl_433's JSON output, stores wind and pressure in SQLite, and once a week lines it up with the dates in your bird notebook: do the waders turn up after a westerly?

- Mechanism: rtl_433 to stdout, a Rust reader with serde, SQLite via rusqlite, a weekly plain-text report.
- Failure mode: the nearest station may be too far away, or its readings poor.
- ⏱ month • 🔧 Rust, rtl_433, SQLite, Pi 4
- **Grounded:** this is the one to start with. First step this weekend: run `rtl_433 -F json` for an evening and count how many stations you hear.

### 2. Po: the radio chooses what you hear (Wishful thinking)

**A valve radio that tunes to birdsong.** Fit a rotary encoder behind the dial of a restored set. Turning the dial moves through your notebook's species, and the Pi plays that bird's call through the radio's own speaker, with a warm-up hum like a real valve set.

- Mechanism: encoder on GPIO, a Rust audio player (rodio), recordings from your own phone clips.
- Failure mode: becomes a furniture project; little Rust learning per hour.
- ⏱ month • 🔧 Rust, GPIO, rodio

### 3. Po: the notebook has one line per year (Exaggeration)

**First-arrival ledger.** Keep only the first date you see each species each year, typed in from the old notebooks, and print a chart of how first arrivals drift across years.

- Mechanism: a CSV, a Rust CLI, a text chart in the terminal.
- Failure mode: only a few years of notebooks means too little data to show drift.
- ⏱ weekend • 🔧 Rust, CSV

## Where I'd start

Direction 1, the grounded one. It uses hardware you already own, teaches real Rust (async IO, serde, SQLite), and the first test costs one evening.
