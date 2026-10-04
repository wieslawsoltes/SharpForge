import { readManagedResources } from '@sharpforge/cil';
import { checkCancellation } from '../load-errors.js';
import { fileHashAlgorithm } from './file-hash.js';
import { invalidManifest, manifestLimit } from './manifest-options.js';

/** Native ResourceLocation flags, separate from ManifestResource public/private visibility flags. */
export const ManifestResourceLocation = Object.freeze({ Embedded: 1, ContainedInAnotherAssembly: 2, ContainedInManifestFile: 4 });

function fileName(name) {
  if (!name || name === '.' || name === '..' || /[/\\:\0]/.test(name)) {
    throw invalidManifest('Manifest file name must be a nonempty portable basename');
  }
  return name;
}

function indexedFile(source, token, readName) {
  const [flags, nameIndex, hashIndex] = source.module.row(token);
  if (flags & ~1) throw invalidManifest('Invalid manifest File flags');
  const name = fileName(readName(nameIndex));
  const hashValue = source.module.blob(hashIndex, { maxBytes: 64 });
  const hashAlgorithm = source.assembly.manifestModule.row(0x20000001)[0];
  fileHashAlgorithm(hashAlgorithm, hashValue);
  return Object.freeze({ assembly: source.assembly, metadataToken: token, name,
    containsMetadata: !(flags & 1), hashAlgorithm, hashValue });
}

/** Reuse the CIL directory parser with canonical RuntimeModule heap bounds; no resource payload is copied. */
export function indexManifestResources(source, options, remainingCharacters, signal) {
  const count = source.module.rowCount(40);
  if (count > options.maxResources) throw manifestLimit('Manifest resource row limit exceeded');
  if (source.pe.resources.size > options.maxDirectoryBytes) throw manifestLimit('CLI resource directory byte limit exceeded');
  let characters = 0;
  const readName = index => {
    checkCancellation(signal);
    const name = source.module.string(index, { maxBytes: options.maxNameBytes });
    characters += name.length;
    if (characters > remainingCharacters) throw manifestLimit('Manifest metadata character budget exceeded');
    return name;
  };
  const adapter = { bytes: source.pe.bytes, offsetOf: source.pe.offsetOf, resources: source.pe.resources,
    metadata: { rows: source.pe.metadata.rows, string: readName } };
  const resources = readManagedResources(adapter, { maxResourceBytes: options.maxDirectoryBytes });
  const start = source.pe.resources.size ? source.pe.offsetOf(source.pe.resources.rva, source.pe.resources.size) : 0;
  const records = new Map();
  const files = new Map();
  const fileNames = new Set();
  for (const resource of resources) {
    checkCancellation(signal);
    if (!resource.name || records.has(resource.name)) throw invalidManifest(`Invalid or duplicate manifest resource name ${resource.name}`);
    if (resource.flags !== 1 && resource.flags !== 2) throw invalidManifest('Invalid manifest resource visibility');
    const table = resource.implementation >>> 24;
    const index = resource.implementation & 0xffffff;
    if (resource.implementation && (![35, 38].includes(table) || !index || index > source.module.rowCount(table))) {
      throw invalidManifest('Invalid manifest resource implementation');
    }
    let file = null;
    if (table === 38) {
      if (!files.has(resource.implementation)) {
        if (files.size >= options.maxFiles) throw manifestLimit('Manifest File metadata limit exceeded');
        file = indexedFile(source, resource.implementation, readName);
        if (fileNames.has(file.name)) throw invalidManifest(`Duplicate manifest file name ${file.name}`);
        files.set(resource.implementation, file);
        fileNames.add(file.name);
      }
      file = files.get(resource.implementation);
      if (!file.containsMetadata && resource.offset !== 0) throw invalidManifest('Non-module resource files require offset zero');
    }
    records.set(resource.name, Object.freeze({ ...resource, file,
      dataOffset: resource.implementation ? null : start + resource.offset + 4 }));
  }
  return Object.freeze({ records, names: Object.freeze([...records.keys()]), characters });
}

/** File implementations select the linked module's CLI resource offset; its own resource names are not authoritative. */
export function linkedModuleResource(source, declaration, options) {
  const pe = source.pe;
  if (pe.resources.size > options.maxDirectoryBytes) throw manifestLimit('CLI resource directory byte limit exceeded');
  const rows = { 40: [[declaration.offset, declaration.flags, 0, 0]] };
  const adapter = { bytes: pe.bytes, offsetOf: pe.offsetOf, resources: pe.resources,
    metadata: { rows, string: () => declaration.name } };
  const resource = readManagedResources(adapter, { maxResourceBytes: options.maxDirectoryBytes })[0];
  const start = pe.offsetOf(pe.resources.rva, pe.resources.size);
  return Object.freeze({ ...resource, file: null, dataOffset: start + resource.offset + 4 });
}
