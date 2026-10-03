import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {boundedRead, localPath, readJSON, sha256, walkFiles} from './files.js';

/** Enumerate each actual workspace package once, with its published tarball filename. */
export async function workspacePackages(root, signal) {
  const packages = [];
  for (const entry of (await readdir(join(root, 'packages'), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) throw new Error('SUPPLY_PACKAGE: unexpected package entry');
    const path = 'packages/' + entry.name + '/package.json';
    const manifest = await readJSON(localPath(root, path), {signal});
    if (!manifest.name || !manifest.version || !manifest.license) throw new Error('SUPPLY_PACKAGE: missing package metadata');
    packages.push({path, manifest, tarball: 'artifacts/' + manifest.name.replace(/^@/, '').replaceAll('/', '-') + '-' + manifest.version + '.tgz'});
  }
  if (!packages.length || new Set(packages.map(item => item.manifest.name)).size !== packages.length) {
    throw new Error('SUPPLY_PACKAGE: empty or duplicate package set');
  }
  return packages;
}

/** Inventory payload bytes. Missing payloads, extra tarballs and symlinks are rejected. */
export async function payloadFiles(root, kind, signal) {
  let names;
  if (kind === 'browser') {
    names = (await walkFiles(join(root, 'dist'), {signal})).map(name => 'dist/' + name);
    if (!names.length) throw new Error('SUPPLY_PAYLOAD: empty browser distribution');
    names.push('artifacts/SharpForge-standalone.html');
  } else if (kind === 'packages') {
    names = (await workspacePackages(root, signal)).map(item => item.tarball);
    const actual = (await readdir(join(root, 'artifacts'))).filter(name => name.endsWith('.tgz')).map(name => 'artifacts/' + name);
    if (JSON.stringify(actual.sort()) !== JSON.stringify([...names].sort())) throw new Error('SUPPLY_PAYLOAD: package set mismatch');
  } else throw new Error('SUPPLY_PAYLOAD: unknown kind');
  const files = [];
  for (const path of names.sort()) {
    const bytes = await boundedRead(localPath(root, path), {signal});
    files.push({path, bytes: bytes.length, sha256: sha256(bytes)});
  }
  return files;
}
