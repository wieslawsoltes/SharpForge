import {dirname, resolve} from 'node:path';
import {boundedRead, isMain, localPath, readJSON, repository, sha256, walkFiles} from './files.js';

/** Verify shipped bytes and reconstruct each published upstream file without network access. */
export async function verifyVendor({root = repository, signal} = {}) {
  const relative = 'packages/editor/src/vendor/manifest.json';
  const manifest = await readJSON(localPath(root, relative), {root, signal});
  const directory = dirname(localPath(root, relative));
  if (manifest.reconstruction?.format !== 1 || !manifest.reconstruction.segments.length) {
    throw new Error('VENDOR_MANIFEST: missing reconstruction');
  }
  const shipped = new Map();
  const expectedNames = ['manifest.json', ...Object.keys(manifest.distributedFiles)].sort();
  const actualNames = (await walkFiles(directory, {boundary: root, signal})).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) throw new Error('VENDOR_FILES: undeclared vendor file');
  for (const [name, expected] of Object.entries(manifest.distributedFiles)) {
    const bytes = await boundedRead(localPath(directory, name), {root, signal});
    if (!/^[a-f0-9]{64}$/.test(expected) || sha256(bytes) !== expected) throw new Error('VENDOR_HASH: ' + name);
    shipped.set(name, bytes);
  }
  const seen = new Set();
  const reconstructed = [];
  for (const segment of manifest.reconstruction.segments) {
    signal?.throwIfAborted();
    const bytes = shipped.get(segment.bundled);
    if (seen.has(segment.upstream) || !bytes || !Number.isSafeInteger(segment.offset) || segment.offset < 0
        || !Number.isSafeInteger(segment.length) || segment.length < 1 || segment.offset + segment.length > bytes.length) {
      throw new Error('VENDOR_SEGMENT: invalid reconstruction range');
    }
    if (typeof segment.prefix !== 'string' || typeof segment.suffix !== 'string') throw new Error('VENDOR_SEGMENT: missing wrapper');
    seen.add(segment.upstream);
    const original = Buffer.concat([
      Buffer.from(segment.prefix), bytes.subarray(segment.offset, segment.offset + segment.length), Buffer.from(segment.suffix),
    ]);
    const digest = sha256(original);
    if (digest !== manifest.upstreamFiles[segment.upstream]) throw new Error('VENDOR_UPSTREAM: ' + segment.upstream);
    reconstructed.push({path: segment.upstream, sha256: digest});
  }
  if (seen.size !== Object.keys(manifest.upstreamFiles).length) throw new Error('VENDOR_MANIFEST: missing upstream segment');
  return {schemaVersion: 1, name: manifest.name, version: manifest.version, license: manifest.license,
    distributed: Object.entries(manifest.distributedFiles).map(([path, hash]) => ({path, sha256: hash})),
    upstream: reconstructed, archive: manifest.upstreamArchive, status: 'pass'};
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(await verifyVendor({root: resolve(process.argv[2] || repository)}), null, 2));
}
