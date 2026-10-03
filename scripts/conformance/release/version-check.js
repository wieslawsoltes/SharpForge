import { parseArgs } from 'node:util';
import { isMain } from '../supply/files.js';
import { checkVersions } from '../release-policy/versions.js';
export { checkVersions, releaseVersion } from '../release-policy/versions.js';

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { tag: { type: 'string' }, root: { type: 'string' } } });
  console.log(JSON.stringify(await checkVersions(values), null, 2));
}
