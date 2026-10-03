import {resolve} from 'node:path';
import {payloadFiles} from './artifacts.js';
import {commit, isMain, readJSON, repository, writeJSON} from './files.js';

/** Seal qualified payload bytes at their build job, before artifact transfer. */
export async function seal({root = repository, kind, signal} = {}) {
  return {schemaVersion: 1, commit: commit(root), kind, files: await payloadFiles(root, kind, signal)};
}

/** Verify exact payload membership, content and source commit against the build-job seal. */
export async function verifySeal({root = repository, manifest, signal} = {}) {
  if (manifest.schemaVersion !== 1 || manifest.commit !== commit(root)) throw new Error('SUPPLY_SEAL: source revision differs');
  const actual = await seal({root, kind: manifest.kind, signal});
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('SUPPLY_SEAL: payload inventory or bytes changed');
  return actual;
}

if (isMain(import.meta.url)) {
  const [mode, kind, file, checkout = repository] = process.argv.slice(2);
  const root = resolve(checkout);
  if (mode === 'create') await writeJSON(file, await seal({root, kind}));
  else if (mode === 'verify') {
    const manifest = await readJSON(file, {root});
    if (manifest.kind !== kind) throw new Error('SUPPLY_SEAL: unexpected artifact kind');
    await verifySeal({root, manifest});
  } else throw new Error('Usage: seal.js create|verify browser|packages manifest.json [checkout]');
}
