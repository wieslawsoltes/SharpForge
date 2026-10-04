import {ProjectSystem, workspaceCandidates, normalizePath, isProjectEvaluationInput} from '@sharpforge/project-system';
import {validateFilePlan} from '@sharpforge/templates';

const MAX_FILES = 20000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const isSource = path => /\.cs$/i.test(path);

export function validateWorkspaceRecords(records, folders = [], {disk, readOnly = false} = {}) {
  if (!Array.isArray(records) || records.length > MAX_FILES) throw new Error('Workspace file limit exceeded');
  validateFilePlan({records, folders}, []);
  let bytes = 0;
  for (const record of records) {
    const lazy = record.lazy === true && Number.isFinite(record.size) && record.size >= 0;
    if (typeof record.text !== 'string' && !(record.bytes instanceof Uint8Array) && !(lazy && (disk?.load || readOnly))) {
      throw new Error('Original file contents are unavailable: ' + record.path);
    }
    if (isSource(record.path) && typeof record.text === 'string') {
      if (record.text.length > 2_000_000) throw new Error('A C# source exceeds the 2 MB editor limit: ' + record.path);
      bytes += record.text.length * 2;
      if (bytes > MAX_SOURCE_BYTES) throw new Error('Loaded source buffers exceed the 64 MiB editor budget');
    }
  }
}

/** Resource identity can require one companion source without requiring the entire compilation to be loaded. */
export async function hydrateEvaluationInputs(system, disk, entry, {signal} = {}) {
  if (!system || !disk?.load) return system?.snapshot() ?? null;
  for (let pass = 0; pass < 4; pass++) {
    const inputs = system.evaluationInputs?.() ?? [];
    const paths = [...new Set(inputs)].filter(path => system.files.get(path)?.lazy);
    if (!paths.length) return system.snapshot();
    for (const path of paths) {
      signal?.throwIfAborted();
      system.files.set(path, await disk.load(path, {signal}));
    }
    system.load(entry);
  }
  throw new Error('Resource input hydration did not converge within the workspace limit');
}

export function sourceBuffers(records, previous = new Map()) {
  return records.filter(record => isSource(record.path) && typeof record.text === 'string').map(record => {
    const old = previous.get(record.path);
    const source = {uri: record.path, text: record.text,
      version: old ? old.version + (old.text === record.text ? 0 : 1) : record.version ?? 1};
    if (record.readOnly !== undefined) source.readOnly = record.readOnly;
    if (record.generated !== undefined) source.generated = record.generated;
    return source;
  });
}

/** Prepare a complete next model before the application retires the current one. */
export async function prepareWorkspaceRecords(input, {folders = [], disk = null, configuration = 'Debug', entry = null,
  startup = null, mode = null, active = null, tabs = [], readOnly = false, signal} = {}) {
  let records = input.map(record => ({...record, path: normalizePath(record.path ?? record.uri)}));
  validateWorkspaceRecords(records, folders, {disk, readOnly});
  if (!readOnly && disk?.load) {
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!record.lazy || !isProjectEvaluationInput(record.path)) continue;
      signal?.throwIfAborted();
      records[index] = await disk.load(record.path, {signal});
    }
  }
  if (!entry && mode !== 'folder') entry = workspaceCandidates(records)[0] ?? null;
  const unloadedEntry = readOnly && records.some(record => record.path === entry && record.lazy);
  const system = entry && !unloadedEntry ? new ProjectSystem(records, {configuration, maxFiles: MAX_FILES}) : null;
  let snapshot = system?.load(entry) ?? null;
  if (snapshot && !snapshot.projects.length && snapshot.diagnostics.some(item => item.severity === 'error')) {
    throw new Error(snapshot.diagnostics.map(item => item.message).join('\n'));
  }
  snapshot = await hydrateEvaluationInputs(system, disk, entry, {signal});
  startup = system ? startup && system.projects.has(startup) ? startup
    : snapshot.projects.find(project => ['exe', 'winexe'].includes(String(project.outputType ?? '').toLowerCase()))?.path
      ?? snapshot.projects.find(project => !project.unloaded)?.path ?? null : null;
  active ??= system?.projects.get(startup)?.compile[0]?.path ?? records.find(record => isSource(record.path))?.path ?? '';
  const index = system?.files ?? new Map(records.map(record => [record.path, record]));
  for (const path of new Set([active, ...tabs])) {
    signal?.throwIfAborted();
    if (index.get(path)?.lazy && disk?.load && !readOnly) index.set(path, await disk.load(path, {signal}));
  }
  records = [...index.values()];
  validateWorkspaceRecords(records, folders, {disk, readOnly});
  const files = sourceBuffers(records);
  const available = new Set(files.map(file => file.uri));
  if (!available.has(active)) active = files[0]?.uri ?? '';
  return {records, folders, system, snapshot, startup, entry, files, active,
    tabs: tabs.length ? tabs.filter(path => available.has(path)) : active ? [active] : [],
    mode: mode ?? (entry ? /\.(slnx|sln)$/i.test(entry) ? 'solution' : 'project' : 'folder')};
}

export function mapWorkspacePath(path, mappings = []) {
  if (typeof path !== 'string') return path;
  const mapping = mappings.find(item => path === item.from || path.startsWith(item.from + '/'));
  return mapping ? mapping.to + path.slice(mapping.from.length) : path;
}
