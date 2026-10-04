// Runs a command under the local resource limits: waits for a machine-wide run slot, caps `node --test`
// parallelism and caps the V8 heap of child Node processes. Usage:
//   node scripts/limited.js node --test tests/compiler-generics.test.js
//   node scripts/limited.js npm run build
import {spawn} from 'node:child_process';
import {acquireRunSlot, limitTestArgs, limitedEnv, resourceLimits} from './planning/lib/resource-limits.js';

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/limited.js <command> [args...]');
  process.exit(2);
}
const limits = resourceLimits();
const isNode = /(^|[\\/])node(\.exe)?$/.test(command);
const args = isNode ? limitTestArgs(rest, limits) : rest;
const release = await acquireRunSlot({limits});
const options = {stdio: 'inherit', env: limitedEnv({...process.env, ...release.environment}, limits),
  shell: !isNode && process.platform === 'win32'};
const child = spawn(isNode ? process.execPath : command, args, options);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { release(); console.error(error.message); process.exit(1); });
child.once('exit', (code, signal) => { release(); process.exit(code ?? (signal === 'SIGINT' ? 130 : 1)); });
