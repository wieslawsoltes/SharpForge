import {hashWorkspaceBytes, hashWorkspaceRecordContent, workspaceRecordBytes, throwIfWorkspaceAborted} from './content-hash.js';
import {workspaceRecordSource, cloneWorkspaceRecordSnapshot, cloneWorkspaceDocumentStates,
  applyWorkspaceRecordWrite} from './transaction-records.js';

export const withinWorkspacePath = (path, root) => path === root || path.startsWith(root + '/');

/** Portable mutation paths cannot escape the selected root or alias a reserved system entry. */
export function validateWorkspacePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /^[\\/]/.test(value) ||
      /[\u0000-\u001f<>:"|?*]/.test(value)) throw new Error('SFW1101: Invalid workspace path');
  const path = value.replaceAll('\\', '/');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || part === '.git' || part === 'node_modules') {
      throw new Error('SFW1101: Reserved or unsafe workspace path: ' + path);
    }
  }
  return path;
}

export function cloneWorkspaceState(value) {
  const state = {...value};
  state.records = (value.records ?? []).map(record => cloneWorkspaceRecordSnapshot(record));
  state.folders = [...(value.folders ?? [])];
  for (const key of ['tabs', 'breakpoints', 'settings', 'openDocuments', 'dirty']) {
    if (value[key] !== undefined) state[key] = structuredClone(value[key]);
  }
  if (value.documentStates !== undefined) state.documentStates = cloneWorkspaceDocumentStates(value.documentStates);
  return state;
}

export function workspaceStateSize(state) {
  const sources = new Set();
  let size = 0;
  for (const record of state.records) {
    const source = workspaceRecordSource(record);
    size += (source?.length ?? record.text?.length ?? 0) * 2 + (record.bytes?.length ?? 0);
    if (source) sources.add(source);
  }
  for (const state of state.documentStates?.values() ?? []) {
    for (const source of [state.source, state.baseline]) {
      if (source == null || sources.has(source)) continue;
      size += (typeof source === 'string' ? source.length : workspaceRecordSource({source})?.length ?? 0) * 2;
      sources.add(source);
    }
  }
  return size;
}

export function hashWorkspaceRecord(record, options) {
  if (record.lazy && !workspaceRecordSource(record) && typeof record.text !== 'string' && !record.bytes) {
    return hashWorkspaceBytes(new TextEncoder().encode(JSON.stringify(['unloaded', record.size, record.lastModified ?? record.mtime,
      record.hash ?? null])), options);
  }
  return hashWorkspaceRecordContent(record, options);
}

/** Hash paths and exact bytes, including empty folders, independently of display order. */
export async function hashWorkspaceState(state, {signal} = {}) {
  const entries = [];
  for (const record of [...state.records].sort((left, right) => left.path.localeCompare(right.path))) {
    throwIfWorkspaceAborted(signal);
    entries.push([record.path, await hashWorkspaceRecord(record, {signal})]);
  }
  return hashWorkspaceBytes(new TextEncoder().encode(JSON.stringify({entries, folders: [...state.folders].sort()})), {signal});
}

export function validateWorkspaceState(state, limits = {}) {
  const {maxFiles = 20000, maxBytes = 128 * 1024 * 1024} = limits;
  if (state.records.length + state.folders.length > maxFiles) throw new Error('SFW1102: Workspace item limit exceeded');
  if (workspaceStateSize(state) > maxBytes) throw new Error('SFW1102: Workspace memory limit exceeded');
  const names = new Map();
  for (const path of [...state.records.map(record => record.path), ...state.folders]) {
    const normalized = validateWorkspacePath(path);
    const key = normalized.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('SFW1103: Destination already exists or case-collides: ' + path);
    names.set(key, path);
  }
  const files = new Set(state.records.map(record => record.path.normalize('NFC').toLowerCase()));
  for (const path of names.keys()) {
    let parent = path;
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      if (files.has(parent)) throw new Error('SFW1103: A file cannot contain another file: ' + parent);
    }
  }
}

/** Apply one preflighted operation only to an isolated staged state. */
export function applyWorkspaceOperation(state, operation) {
  const path = validateWorkspacePath(operation.path);
  const records = new Map(state.records.map(record => [record.path, record]));
  const folders = new Set(state.folders);
  const exists = root => [...records.keys(), ...folders].some(candidate => withinWorkspacePath(candidate, root));
  const requireAbsent = root => {
    if (exists(root)) throw new Error('SFW1103: Destination already exists: ' + root);
  };
  const file = records.get(path);
  if (operation.kind === 'create' || operation.kind === 'write') {
    if (operation.kind === 'create') requireAbsent(path);
    else if (!file) throw new Error('SFW1104: Missing text file: ' + path);
    const record = applyWorkspaceRecordWrite(file, operation, path);
    if (!workspaceRecordSource(record)) workspaceRecordBytes(record);
    records.set(path, record);
  } else if (operation.kind === 'mkdir') {
    requireAbsent(path);
    folders.add(path);
  } else if (['rename', 'move', 'copy', 'delete'].includes(operation.kind)) {
    if (!exists(path)) throw new Error('SFW1104: Source no longer exists: ' + path);
    const children = [...records].filter(([candidate]) => withinWorkspacePath(candidate, path));
    const directories = [...folders].filter(candidate => withinWorkspacePath(candidate, path));
    if (operation.kind !== 'delete') {
      const destination = validateWorkspacePath(operation.destination);
      if (withinWorkspacePath(destination, path)) throw new Error('SFW1105: An item cannot contain itself');
      requireAbsent(destination);
      for (const [candidate, record] of children) {
        const target = destination + candidate.slice(path.length);
        records.set(target, cloneWorkspaceRecordSnapshot(record, target));
      }
      for (const candidate of directories) folders.add(destination + candidate.slice(path.length));
    }
    if (operation.kind !== 'copy') {
      for (const [candidate] of children) records.delete(candidate);
      for (const candidate of directories) folders.delete(candidate);
      const mapPath = candidate => typeof candidate !== 'string' || !withinWorkspacePath(candidate, path) ? candidate :
        operation.kind === 'delete' ? null : operation.destination + candidate.slice(path.length);
      for (const key of ['active', 'entry', 'startup']) if (state[key] !== undefined) state[key] = mapPath(state[key]);
      for (const key of ['tabs', 'dirty']) if (state[key]) state[key] = state[key].map(mapPath).filter(Boolean);
      if (state.openDocuments) state.openDocuments = state.openDocuments.map(document => typeof document === 'string' ? mapPath(document) :
        {...document, path: mapPath(document.path)}).filter(document => typeof document === 'string' || document?.path);
      if (state.breakpoints) state.breakpoints = Object.fromEntries(Object.entries(state.breakpoints)
        .map(([candidate, values]) => [mapPath(candidate), values]).filter(([candidate]) => candidate));
    }
  } else throw new Error('SFW1106: Unsupported workspace operation: ' + operation.kind);
  state.records = [...records.values()];
  state.folders = [...folders];
}

/** Produce deterministic replacement operations for undo/redo without changing untouched records. */
export async function diffWorkspaceStates(current, target, options = {}) {
  const before = new Map(current.records.map(record => [record.path, record]));
  const after = new Map(target.records.map(record => [record.path, record]));
  const operations = [];
  const removedFolders = current.folders.filter(path => !target.folders.includes(path));
  const roots = removedFolders.filter(path => !removedFolders.some(other => other !== path && withinWorkspacePath(path, other)));
  for (const path of roots) operations.push({kind: 'delete', path});
  for (const path of before.keys()) {
    if (!after.has(path) && !roots.some(root => withinWorkspacePath(path, root))) operations.push({kind: 'delete', path});
  }
  for (const path of target.folders.filter(path => !current.folders.includes(path)).sort()) operations.push({kind: 'mkdir', path});
  for (const [path, record] of after) {
    const previous = before.get(path);
    const deletedParent = roots.some(root => withinWorkspacePath(path, root));
    if (!previous || deletedParent) operations.push({kind: 'create', path, record});
    else if (await hashWorkspaceRecord(record, options) !==
             await hashWorkspaceRecord(previous, options)) operations.push({kind: 'write', path, record});
  }
  return operations;
}
