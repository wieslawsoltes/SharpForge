import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Use the shared browser harness and production CSP; optional baseline enforces the 20% relative regression gate.
const script = fileURLToPath(new URL('../tests/browser_workbench_perf_test.py', import.meta.url));
const result = spawnSync(process.env.PYTHON ?? 'python3', [script], {stdio: 'inherit', env: process.env});
if (result.error) throw result.error;
if (result.signal) throw new Error('Workbench benchmark terminated by ' + result.signal);
process.exitCode = result.status ?? 1;
