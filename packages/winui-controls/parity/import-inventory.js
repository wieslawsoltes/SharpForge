import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractNative } from '../../../scripts/conformance/inventory/native-metadata.js';
import { lockedMetadataSelection, selectPackageMetadataFiles, metadataSelectionProvenance } from './metadata-selection.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packageNames = ['Microsoft.WindowsAppSDK.WinUI', 'Microsoft.WindowsAppSDK.Foundation',
  'Microsoft.WindowsAppSDK.InteractiveExperiences'];
const requiredNamespaces = ['Microsoft.UI.Xaml.', 'Microsoft.UI.Composition.', 'Microsoft.UI.Windowing.',
  'Microsoft.UI.Dispatching.', 'Microsoft.UI.Input.'];
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function packageFiles(directory) {
  const result = [];
  const pending = [{ directory, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current.directory, { withFileTypes: true })) {
      if (++count > 10_000) throw new RangeError('Pinned package exceeds the traversal budget');
      if (entry.isSymbolicLink()) continue;
      const file = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth >= 8) throw new RangeError('Pinned package exceeds the directory-depth budget');
        pending.push({ directory: file, depth: current.depth + 1 });
      } else if (entry.isFile() && (/\.winmd$/i.test(entry.name) || /license|\.nuspec$/i.test(entry.name))) result.push(file);
    }
  }
  return result.sort();
}

/** Reads restored, locked packages only. It never downloads packages or redistributes proprietary binaries. */
export async function importPinnedInventory({ packageRoot = process.env.NUGET_PACKAGES ?? path.join(os.homedir(), '.nuget/packages'),
  output = 'packages/winui-controls/parity/winappsdk-inventory.json', signal, toolchain } = {}) {
  const lockBytes = await readFile(path.join(root, 'tests/conformance/oracle/WinUI/packages.lock.json'));
  const lock = JSON.parse(lockBytes);
  const selection = lockedMetadataSelection(lock);
  const { dependencies } = selection;
  const packages = [];
  const metadata = new Map();
  for (const name of packageNames) {
    const pin = dependencies[name];
    if (!pin?.resolved || !pin.contentHash) throw new Error('Missing locked metadata package: ' + name);
    const directory = path.join(packageRoot, name.toLowerCase(), pin.resolved);
    const files = selectPackageMetadataFiles(name, await packageFiles(directory), { directory, selection });
    const licenseProvenance = [];
    const metadataProvenance = [];
    for (const file of files) {
      signal?.throwIfAborted();
      const digest = sha256(await readFile(file));
      if (!/\.winmd$/i.test(file)) { licenseProvenance.push({ file: path.relative(directory, file), sha256: digest }); continue; }
      const identity = path.basename(file).toLowerCase();
      if (metadata.has(identity) && metadata.get(identity).sha256 !== digest) {
        throw new Error('Ambiguous locked WinMD identity: ' + path.basename(file));
      }
      metadata.set(identity, { path: file, sha256: digest });
      metadataProvenance.push({ file: path.relative(directory, file).split(path.sep).join('/'), sha256: digest });
    }
    if (!licenseProvenance.length) throw new Error('Missing package license/nuspec provenance: ' + name);
    const metadataSelection = metadataSelectionProvenance(name, selection);
    if (metadataSelection) metadataSelection.ruleSHA256 = sha256(await readFile(path.join(directory, metadataSelection.ruleFile)));
    packages.push({ name, version: pin.resolved, contentHash: pin.contentHash, licenseProvenance, metadataProvenance, metadataSelection });
  }
  const inputs = [...metadata.values()].map(value => value.path).sort();
  if (!inputs.length) throw new Error('Restore the pinned WinUI oracle packages in locked mode before importing metadata');
  const extracted = await extractNative('metadata', inputs, { signal, toolchain });
  const rows = extracted.rows.filter(row => /^Microsoft\.UI\./.test(row.owner)).map(row => ({ ...row,
    key: `winui:${row.assembly}:${row.kind}:${row.signature}` }));
  for (const prefix of requiredNamespaces) {
    if (!rows.some(row => row.owner.startsWith(prefix))) throw new Error('Pinned package set does not cover required namespace: ' + prefix);
  }
  const previous = JSON.parse(await readFile(path.join(root, 'planning/qualification/inventory/winui-api.json'), 'utf8'));
  const identities = new Map(rows.map(row => [row.key, row]));
  if (identities.size !== rows.length) throw new Error('Duplicate imported reference identity');
  for (const row of previous.rows) {
    const next = identities.get(row.key);
    if (!next || next.signature !== row.signature) throw new Error('Pinned supplement changed a sealed reference: ' + row.key);
    next.gapId = row.gapId;
    next.leafId = row.leafId;
  }
  const result = { schemaVersion: 1, windowsAppSDK: dependencies['Microsoft.WindowsAppSDK'].resolved,
    targetFramework: selection.framework, targetPlatformVersion: selection.targetPlatformVersion,
    lockSHA256: sha256(lockBytes), packages, referenceFiles: extracted.files, extractor: extracted.extractor,
    licensePolicy: 'Public API facts only. Package licenses remain applicable; WinMD binaries, fonts and Windows binaries are not redistributed.',
    rows: rows.sort((left, right) => left.key.localeCompare(right.key, 'en')) };
  await mkdir(path.dirname(path.resolve(root, output)), { recursive: true });
  await writeFile(path.resolve(root, output), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await importPinnedInventory();
  console.log(JSON.stringify({ windowsAppSDK: result.windowsAppSDK, rows: result.rows.length, files: result.referenceFiles.map(file => file.name) }));
}
