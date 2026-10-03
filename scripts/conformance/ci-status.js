import {pathToFileURL} from 'node:url';
export function checkStatus(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs) || !Object.keys(needs).length) throw new Error('Missing required job results');
  const failed = Object.entries(needs).filter(([, job]) => job?.result !== 'success');
  if (failed.length) throw new Error('Required jobs did not succeed: ' + failed.map(([name, job]) => `${name}=${job?.result ?? 'missing'}`).join(', '));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkStatus(JSON.parse(process.env.SHARPFORGE_CI_NEEDS || 'null'));
  console.log('All required qualification jobs succeeded.');
}
