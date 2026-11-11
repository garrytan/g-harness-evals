// Bun ignores [test] timeout in bunfig.toml (oven-sh/bun#7789), so this preload raises the 5 s default; a serial run keeps it for its first file only, so serial runs also pass --timeout=30000.
import { setDefaultTimeout } from 'bun:test';

setDefaultTimeout(30_000);
