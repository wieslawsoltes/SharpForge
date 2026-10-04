import {metadataLimits, metadataError} from './limits.js';

const pathOf = record => record.path ?? record.uri;
const baseName = path => path.replaceAll('\\', '/').split('/').at(-1).toLowerCase();

function recordsFor(state) {
  if (state.projectSystem?.files instanceof Map) return state.projectSystem.files;
  const result = new Map();
  for (const record of state.diskRecords ?? state.extraFiles ?? []) {
    const path = pathOf(record);
    if (path && !result.has(path)) result.set(path, record);
  }
  return result;
}

function consumers(projects) {
  const result = new Map();
  for (const project of projects.values()) {
    const seen = new Set(), pending = [project.path];
    while (pending.length) {
      const path = pending.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      const users = result.get(path) ?? [];
      users.push(project.id ?? project.path);
      result.set(path, users);
      for (const reference of projects.get(path)?.projectReferences ?? []) pending.push(reference.path);
    }
  }
  return result;
}

async function recordBytes(record, descriptor, readReference, signal) {
  signal?.throwIfAborted();
  if (record?.bytes instanceof Uint8Array) return record.bytes;
  if (record?.base64 !== undefined) {
    if (typeof record.base64 !== 'string' || record.base64.length > Math.ceil(metadataLimits.bytes / 3) * 4) {
      throw metadataError('METADATA_BYTES_LIMIT', 'Encoded reference exceeds the metadata inspection limit');
    }
    try { return Uint8Array.from(atob(record.base64), character => character.charCodeAt(0)); }
    catch (error) { throw metadataError('METADATA_ENCODING', 'Invalid reference encoding: ' + error.message); }
  }
  if (readReference) return readReference(descriptor, {signal});
  throw metadataError('METADATA_REFERENCE_UNAVAILABLE', 'Reference ' + descriptor.name + ' is not in the opened workspace. ' +
    'Open its containing folder or add the referenced PE file to inspect it.');
}

/** Enumerates reference metadata without touching any source document text or copying binary contents. */
export function createStudioMetadataSources({state, additional = () => [], readReference} = {}) {
  const identities = new WeakMap();
  let serial = 0;
  const recordIdentity = record => {
    if (!record || typeof record !== 'object') return 0;
    if (!identities.has(record)) identities.set(record, ++serial);
    return identities.get(record);
  };
  return async () => {
    const current = state?.() ?? {}, records = recordsFor(current), result = [];
    const projects = current.projectSystem?.projects ?? new Map(), visibleTo = consumers(projects);
    const workspaceEpoch = current.workspaceEpoch ?? current.projectSystem?.solution?.path ?? current.name ?? '';
    for (const project of projects.values()) {
      for (const reference of project.references ?? []) {
        const shortName = String(reference.name ?? '').split(',')[0].trim();
        const matches = reference.hintPath ? [records.get(reference.hintPath)].filter(Boolean) :
          [...records].filter(([path]) => baseName(path) === shortName.toLowerCase() + '.dll').map(([, record]) => record);
        const record = matches.length === 1 ? matches[0] : null;
        const path = reference.hintPath ?? pathOf(record ?? {}) ?? shortName;
        const version = `${workspaceEpoch}:${record?.version ?? record?.lastModified ?? 0}:${recordIdentity(record)}:` +
          `${current.configuration ?? ''}:${current.platform ?? ''}`;
        const descriptor = {id: project.path + ':' + path, projectId: project.id ?? project.path, name: shortName,
          path, version, workspaceEpoch, reference, consumers: visibleTo.get(project.path)};
        if (matches.length > 1) descriptor.error = metadataError('METADATA_REFERENCE_AMBIGUOUS',
          'More than one opened file matches ' + shortName + '; specify its HintPath in the project');
        descriptor.read = ({signal}) => recordBytes(record, descriptor, readReference, signal);
        result.push(descriptor);
      }
    }
    const extra = typeof additional === 'function' ? await additional() : additional;
    for (const [index, assembly] of (extra ?? []).entries()) {
      const descriptor = {id: assembly.id ?? 'provided:' + index, projectId: assembly.projectId,
        path: assembly.path, name: assembly.name ?? assembly.summary?.name ?? 'Assembly',
        version: `${workspaceEpoch}:${assembly.version ?? assembly.summary?.version ?? 0}:${recordIdentity(assembly)}`, workspaceEpoch};
      if (assembly.schemaVersion === 1 && Array.isArray(assembly.types)) descriptor.model = assembly;
      else if (assembly.summary || Array.isArray(assembly.types)) descriptor.summary = assembly.summary ?? assembly;
      else descriptor.read = ({signal}) => recordBytes(assembly, descriptor, readReference, signal);
      result.push(descriptor);
    }
    if (result.length > metadataLimits.sources) throw metadataError('METADATA_ASSEMBLY_LIMIT',
      'The workspace exceeds the ' + metadataLimits.sources + ' reference-source limit');
    return result;
  };
}
