// Bun ignores [test] timeout in bunfig.toml (oven-sh/bun#7789), so this preload raises the 5 s default. Bun fixes a test's
// timeout when the test registers and resets the default for each file, so a default set once here reached only the
// first file of a serial run; the onLoad hook sets it again as each test file loads, before its tests register.
import { setDefaultTimeout } from 'bun:test';

setDefaultTimeout(30_000);

Bun.plugin({
  name: 'default-timeout',
  setup(build) {
    build.onLoad({ filter: /\.test\.ts$/ }, async ({ path }) => {
      setDefaultTimeout(30_000);
      return { contents: await Bun.file(path).text(), loader: 'ts' };
    });
  },
});
