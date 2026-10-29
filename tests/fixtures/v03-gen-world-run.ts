// Runs scripts/v03/gen-world.ts with the keyless fake transport, as a separate process, so the test can capture
// everything it prints.
import { main } from '../../scripts/v03/gen-world.ts';
import { fakeTransport } from './v03-fake-transport.ts';

process.exit(await main(process.argv.slice(2), fakeTransport));
