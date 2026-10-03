// Execute only after the whole E01 scope is integrated. Every case runs the same
// Roslyn-produced bytes on native .NET and the direct CIL engine.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=spawnSync(process.execPath,['scripts/validate-a05-type-system.js','--task','SF-A05-E01-T02-T04','--unsafe','--fixture','tests/fixtures/a05-calls','--fixture','tests/fixtures/a05-exceptions','--output','artifacts/a05-control',...process.argv.slice(2)],{cwd:root,stdio:'inherit',env:process.env});
if(result.error)throw result.error;
if(result.signal)throw new Error('Control qualification terminated: '+result.signal);
process.exitCode=result.status;
