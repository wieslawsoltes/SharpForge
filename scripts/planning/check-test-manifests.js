import {discoverManifests, parseTestArgs, isMain} from './test-manifests.js';
export async function checkTestManifests(root) {
  const manifests = await discoverManifests(root);
  return {areas: manifests.length, nodeFiles: manifests.reduce((n, m) => n + m.nodeFiles.length, 0), browserScripts: manifests.reduce((n, m) => n + m.browserScripts.length, 0), unassigned: 0, duplicate: 0};
}
if (isMain(import.meta.url)) {
  try {console.log(JSON.stringify(await checkTestManifests(parseTestArgs(process.argv.slice(2)).root), null, 2));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}
