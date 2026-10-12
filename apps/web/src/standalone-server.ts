// oxlint-disable-next-line import/no-unassigned-import -- load a local .env before validating standalone startup
import '@care/config/load-env';
import { loadWebConfig } from '@care/config';

loadWebConfig();

// Keep this indirect so the bundler leaves Next's generated standalone server as a runtime import.
const serverEntry = './server.js';
await import(serverEntry);
