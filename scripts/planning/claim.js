import { main } from './lib/claim-cli.js';
main('claim').catch(error => { console.error(error.message); process.exitCode = error.exitCode ?? 1; });
