import {join, resolve} from 'node:path';
import {payloadFiles, workspacePackages} from './artifacts.js';
import {verifyVendor} from './verify-vendor.js';
import {boundedRead, commit, isMain, localPath, readJSON, repository, sha256, writeJSON} from './files.js';

function fileComponent(file) {
  return {type: 'file', 'bom-ref': 'file:' + file.path, name: file.path,
    hashes: [{alg: 'SHA-256', content: file.sha256}],
    properties: [{name: 'sharpforge:bytes', value: String(file.bytes)}]};
}

function packageComponent(manifest) {
  const purl = 'pkg:npm/' + manifest.name.replace('@', '%40') + '@' + manifest.version;
  return {type: 'library', 'bom-ref': purl, name: manifest.name, version: manifest.version, purl,
    licenses: [{license: {id: manifest.license}}]};
}

/** Build deterministic CycloneDX 1.6 from actual packages, vendor reconstruction and release payload bytes. */
export async function sbom({root = repository, signal} = {}) {
  const manifest = await readJSON(join(root, 'package.json'), {root, signal});
  const packages = await workspacePackages(root, signal);
  const vendor = await verifyVendor({root, signal});
  const payloads = [...await payloadFiles(root, 'browser', signal), ...await payloadFiles(root, 'packages', signal)];
  const archive = 'artifacts/SharpForge-browser.zip';
  const archiveBytes = await boundedRead(localPath(root, archive), {root, signal});
  payloads.push({path: archive, bytes: archiveBytes.length, sha256: sha256(archiveBytes)});
  const rootRef = 'sharpforge:' + manifest.version;
  const components = packages.map(item => packageComponent(item.manifest));
  const vendorRef = 'pkg:npm/codemirror@' + vendor.version;
  components.push({type: 'library', 'bom-ref': vendorRef, name: vendor.name, version: vendor.version,
    purl: vendorRef, licenses: [{license: {id: vendor.license}}],
    hashes: [{alg: 'SHA-256', content: vendor.archive.sha256}],
    externalReferences: [{type: 'distribution', url: vendor.archive.url}],
    properties: [{name: 'sharpforge:scope', value: 'Selected upstream bodies with declared owner-document wrapper adaptations'}]});
  for (const file of vendor.distributed) {
    const path = 'packages/editor/src/vendor/' + file.path;
    const bytes = await boundedRead(localPath(root, path), {root, signal});
    components.push(fileComponent({path, bytes: bytes.length, sha256: file.sha256}));
  }
  components.push(...payloads.map(fileComponent));
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'], 'en'));
  const packageRefs = new Map(components.filter(item => item.type === 'library').map(item => [item.name, item['bom-ref']]));
  const dependencies = packages.map(item => ({ref: packageRefs.get(item.manifest.name),
    dependsOn: Object.keys(item.manifest.dependencies || {}).map(name => {
      if (!packageRefs.has(name)) throw new Error('SBOM_DEPENDENCY: missing component ' + name);
      return packageRefs.get(name);
    }).sort()}));
  dependencies.find(item => item.ref === packageRefs.get('@sharpforge/editor')).dependsOn.push(vendorRef);
  dependencies.push({ref: rootRef, dependsOn: components.map(item => item['bom-ref'])});
  return {bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: {component: {type: 'application', 'bom-ref': rootRef, name: 'SharpForge', version: manifest.version,
      licenses: [{license: {id: 'MIT'}}]}, properties: [{name: 'sharpforge:sourceCommit', value: commit(root)}]},
    components, dependencies};
}

if (isMain(import.meta.url)) {
  await writeJSON(process.argv[2] || 'artifacts/SBOM.cdx.json', await sbom({root: resolve(process.argv[3] || repository)}));
}
