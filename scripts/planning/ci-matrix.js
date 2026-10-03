import {resolve} from 'node:path';
import {validate} from './schema/validate.js';
import {discoverManifests, readJson, repositoryRoot, parseTestArgs, isMain} from './test-manifests.js';
export async function ciMatrix(root = repositoryRoot) {
  const manifests = await discoverManifests(root);
  const matrix = {include: manifests.filter(m => m.nodeFiles.length || m.browserScripts.length).map(({nodeFiles, ...manifest}) => manifest)};
  return validate(await readJson(resolve(root, 'planning/contracts/ci-matrix.schema.json')), matrix);
}
if (isMain(import.meta.url)) {
  try {console.log(JSON.stringify(await ciMatrix(parseTestArgs(process.argv.slice(2)).root)));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
