import { main } from './lib/claim-cli.js';
main('heartbeat').catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1; });
