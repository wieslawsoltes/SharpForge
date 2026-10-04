import {
  ProjectSystem, DiskWorkspace, validateWorkspaceSettings, workspaceCandidates, isProjectEvaluationInput, recordSource
} from '@sharpforge/project-system';
import {validateFilePlan} from '@sharpforge/templates';
import {prepareExplorerRecord} from '../explorer-records.js';
import {studioDiskLimits, validateStudioWorkspaceRecords, isStudioTextRecord, isStudioLazyRecord} from './workspace-limits.js';
import {studioSourceRecord, releaseStudioSources} from './studio-source-records.js';

function checkInput(input) {
  input.signal?.throwIfAborted();
  input.check?.();
}

async function loadInputs(index, paths, input) {
  for (const path of new Set(paths)) {
    if (!index.get(path)?.lazy) continue;
    checkInput(input);
    const record = await input.disk.load(path, {signal: input.signal, beforeAdmit: () => checkInput(input)});
    checkInput(input);
    index.set(path, studioSourceRecord(record));
  }
}

async function evaluateWorkspace(index, entry, configuration, input) {
  if (!entry || input.readOnly && index.get(entry)?.lazy) return {system: null, snapshot: null};
  if (input.disk?.load && !input.readOnly) {
    await loadInputs(index, [...index.keys()].filter(isProjectEvaluationInput), input);
  }
  const system = new ProjectSystem([...index.values()], {configuration, maxFiles: studioDiskLimits.maxFiles});
  let snapshot = system.load(entry);
  for (let round = 0; round < 4 && input.disk?.load && !input.readOnly; round++) {
    const paths = system.evaluationInputs().filter(path => index.get(path)?.lazy);
    if (!paths.length) break;
    await loadInputs(index, paths, input);
    for (const path of paths) system.files.set(path, index.get(path));
    snapshot = system.load(entry);
  }
  if (snapshot && !snapshot.projects.length && snapshot.diagnostics.some(item => item.severity === 'error')) {
    throw new Error(snapshot.diagnostics.map(item => item.message).join('\n'));
  }
  return {system, snapshot};
}

function prepareSources(records, input, context) {
  const sources = [];
  try {
    for (const record of records) {
      if (!/\.cs$/i.test(record.path) || !isStudioTextRecord(record)) continue;
      const prepared = prepareExplorerRecord(record);
      if (input.readOnly) Object.defineProperty(prepared, 'readOnly', {value: true, enumerable: true, configurable: true});
      sources.push(studioSourceRecord(prepared, {
        version: prepared.model?.version ?? recordSource(prepared)?.version ?? prepared.version ?? 1
      }));
    }
    return sources;
  } catch (error) {
    releaseStudioSources(sources, context.documents ?? {ownsModel: () => false});
    throw error;
  }
}

function restoredDocumentStates(sources, input, context) {
  const supplied = input.documentStates;
  if (supplied !== undefined && !(supplied instanceof Map)) throw new TypeError('Restored document states must be a Map');
  if (input.dirty === undefined) return supplied ?? null;
  const dirty = new Set(input.dirty);
  const states = new Map();
  for (const record of sources) {
    const source = recordSource(record) ?? record.text;
    const owned = context.documents?.get(record.uri) ? context.documents.captureState(record.uri) : null;
    const previous = supplied?.get(record.uri) ?? (owned?.source === source ? owned : null);
    const changed = dirty.has(record.uri);
    states.set(record.uri, Object.freeze({uri: record.uri, version: record.version, source,
      baseline: changed ? previous?.baseline ?? null : source, dirty: changed, staleSave: changed && previous?.staleSave === true}));
  }
  return states;
}

/** Validate and hydrate only evaluation/open-document inputs before transferring prepared source ownership. */
export async function prepareStudioWorkspace(input, context = {}) {
  const {folders = [], configuration = 'Debug'} = input;
  let records = input.records.map(record => studioSourceRecord(record));
  const entry = input.entry ?? (input.mode === 'folder' ? null : workspaceCandidates(records)[0] ?? null);
  const mode = input.mode ?? (entry ? /\.(slnx|sln)$/i.test(entry) ? 'solution' : 'project' : 'folder');
  validateFilePlan({records, folders}, []);
  const allowLazy = input.readOnly === true || typeof input.disk?.load === 'function';
  for (const record of records) {
    if (!isStudioTextRecord(record) && !(record.bytes instanceof Uint8Array) && !(allowLazy && isStudioLazyRecord(record))) {
      throw new TypeError('Every workspace file must provide text, binary bytes or authorized lazy metadata; no workspace was changed.');
    }
  }
  await validateStudioWorkspaceRecords(records, {signal: input.signal, allowLazy});
  checkInput(input);
  const checked = input.settings ? validateWorkspaceSettings(input.settings, records.map(record => record.path)) : {};
  const index = new Map(records.map(record => [record.path, record]));
  const {system, snapshot} = await evaluateWorkspace(index, entry, configuration, input);
  checkInput(input);
  const startup = system ? input.startup && system.projects.has(input.startup) ? input.startup
    : snapshot.projects.find(project => ['exe', 'winexe'].includes(project.outputType.toLowerCase()))?.path
      ?? snapshot.projects[0]?.path ?? null : null;
  const candidates = [checked.active, ...(system?.projects.get(startup)?.compile ?? []).map(file => file.path),
    records.find(record => /\.cs$/i.test(record.path))?.path];
  if (input.disk?.load && !input.readOnly) {
    const active = candidates.find(path => path && index.has(path));
    await loadInputs(index, [active, ...(checked.tabs ?? [])].filter(path => /\.cs$/i.test(path ?? '')), input);
  }
  records = [...index.values()];
  if (system) for (const [path, record] of index) system.files.set(path, record);
  const {byteLengths} = await validateStudioWorkspaceRecords(records, {signal: input.signal, allowLazy});
  checkInput(input);
  records = records.map(record => {
    const descriptors = Object.getOwnPropertyDescriptors(studioSourceRecord(record));
    // Recompute admission metadata before creating the clone; imported descriptors may be non-configurable.
    descriptors.byteLength = {value: byteLengths.get(record), enumerable: true, writable: true, configurable: true};
    return Object.defineProperties({}, descriptors);
  });
  const disk = input.disk ?? new DiskWorkspace(records, undefined, input.name ?? 'Workspace', folders, [], {
    ...studioDiskLimits, readSource: context.readSource
  });
  const projects = system ? [...system.projects.values()] : [{id: '$workspace', outputType: 'exe'}];
  const recovery = input.preserveDocumentState ? null : context.sessionRecovery?.prepare(checked, {projects});
  const sources = prepareSources(records, input, context);
  try {
    const available = new Set(sources.map(record => record.uri));
    const active = candidates.find(uri => available.has(uri)) ?? sources[0]?.uri ?? '';
    const tabs = checked.tabs?.filter(uri => available.has(uri)) ?? (active ? [active] : []);
    const documentStates = restoredDocumentStates(sources, input, context);
    return {...input, records, folders, configuration, entry, mode, system, snapshot, sources, checked, recovery,
      disk, startup, active, tabs, documentStates};
  } catch (error) {
    releaseStudioSources(sources, context.documents ?? {ownsModel: () => false});
    throw error;
  }
}
