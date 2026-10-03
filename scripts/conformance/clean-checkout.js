import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resultPath, repository} from './results.js';

export function checkoutStatus(cwd = repository) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {cwd, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  return result.stdout;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = checkoutStatus();
  await writeFile(await resultPath('checkout-status.txt'), status || 'Clean checkout\n');
  if (status) {console.error('Qualification changed the checkout:\n' + status); process.exitCode = 1;}
  else console.log('Clean checkout: no tracked modifications or unignored outputs.');
}
