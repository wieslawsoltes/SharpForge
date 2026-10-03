import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {bclMetadata} from '../../../scripts/conformance/inventory/native-metadata.js';
import {canonicalJSON, pin} from '../../../scripts/conformance/inventory/common.js';

const owners = ['System.String', 'System.Text.StringBuilder', 'System.Array', 'System.Random'];

/** Capture unmodified public metadata rows from the repository's pinned native reference extractor. */
export async function captureReference(options = {}) {
  const metadata = await bclMetadata(options);
  const selected = new Set(owners);
  const rows = metadata.rows.filter(row => selected.has(row.owner));
  const assemblies = new Set(rows.map(row => row.assembly));
  for (const owner of owners) {
    if (!rows.some(row => row.owner === owner && row.kind === 'type')) {
      throw new Error('Pinned reference is missing ' + owner);
    }
  }
  return {
    schemaVersion: metadata.schemaVersion,
    runtime: metadata.runtime,
    referencePack: pin.referencePack,
    referenceAssemblies: pin.referenceAssemblies,
    extractor: metadata.extractor,
    owners,
    files: metadata.files.filter(file => assemblies.has(file.assembly)),
    rows
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL('../reference/dotnet-10.0.5.json', import.meta.url);
  const reference = await captureReference();
  await mkdir(new URL('../reference/', import.meta.url), {recursive: true});
  await writeFile(output, canonicalJSON(reference));
  console.log(`Captured ${reference.rows.length} native reference rows for ${reference.owners.length} BCL types.`);
}
