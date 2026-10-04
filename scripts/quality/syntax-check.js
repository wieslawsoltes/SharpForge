import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Run the serial parser in one flagged Node process; checked files are never evaluated. */
export function runSyntaxCheck(root = process.cwd()) {
  const worker = fileURLToPath(new URL('./syntax-check-worker.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', worker, root], {
    stdio: 'inherit',
  });
  // NODE_OPTIONS (including heap limits and grammar flags) is inherited unchanged.
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
