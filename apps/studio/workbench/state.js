import { WorkbenchEvents } from './state-events.js';
import { legacyDebug, setLegacyDebug } from './session-compat.js';

export const workspaceStateFields = Object.freeze({
  documents: Object.freeze([
    'files', 'tabs', 'active', 'dirtyFiles', 'revision', 'disk', 'diskRevision', 'extraFiles', 'folders', 'membershipDirty',
    'projectSystem', 'projectSnapshot', 'startupProject', 'workspaceEpoch', 'workspaceMode', 'applyingEdits', 'name',
    'configuration', 'nativeMode', 'nativeWorkspace', 'nativeStartup', 'nativeJob', 'itemSelection', 'breakpoints', 'functionBreakpoints',
    'recoveryReadOnly', 'recoveryEntry', 'recoveryMetadata'
  ]),
  build: Object.freeze([
    'result', 'image', 'assembly', 'pdb', 'buildDirty', 'compileBusy', 'projectDiagnostics', 'toolReferences', 'extensionConfig',
    'importedAssembly', 'selectedMethod', 'ilDump', 'disassemblyFormat', 'analyzeTimer', 'langVersion'
  ]),
  sessions: Object.freeze([
    'debug', 'programOutput', 'frameId', 'debugSources', 'debugSourceRecords', 'debugSourceOriginals',
    'runtimeSession', 'watchResults', 'watches', 'watchEpoch', 'debugSettings',
    'runtimeSettings', 'launchEpoch', 'launchBusy', 'controlBusy', 'hotEdit', 'immediateHistory', 'lastManagedLaunch',
    'inspectedLocals', 'inspectedThreadFrames', 'inspectedThreadId', 'objectContext', 'functionEvaluationEnabled',
    'functionEvaluationRollback', 'readOnly', 'renderedBreakpoints'
  ]),
  ui: Object.freeze(['keymap', 'panel', 'outputKind', 'logs', 'modalClose', 'modalBusy', 'saveTimer'])
});

const documentMembers = new Set(['files', 'tabs', 'active', 'dirtyFiles', 'revision']);
const buildMembers = new Map([
  ['result', 'result'], ['image', 'image'], ['assembly', 'assembly'], ['pdb', 'pdb'], ['buildDirty', 'dirty'], ['compileBusy', 'busy']
]);
const sessionMembers = new Set(workspaceStateFields.sessions.filter(key => !['debugSettings', 'readOnly', 'renderedBreakpoints'].includes(key)));

/** Explicit property descriptors preserve old call sites while ownership is moved into services. */
export function createWorkspaceState(initial = {}, services = {}) {
  const slices = { documents: {}, build: {}, sessions: {}, ui: {} };
  const events = new WorkbenchEvents();
  const ownership = new Map();
  for (const [slice, fields] of Object.entries(workspaceStateFields)) for (const key of fields) ownership.set(key, slice);
  for (const key of Object.keys(initial)) if (!ownership.has(key)) ownership.set(key, 'ui');
  for (const [key, value] of Object.entries(initial)) slices[ownership.get(key)][key] = value;
  const documents = services.documents;
  const builds = services.builds;
  const sessions = services.sessions;
  if (documents && initial.files) {
    const available = new Set(initial.files.map(file => file.uri));
    documents.replace(initial.files, {
      tabs: (initial.tabs ?? []).filter(uri => available.has(uri)),
      active: available.has(initial.active) ? initial.active : '',
      discard: true
    });
    if (!initial.files.length && initial.active) documents.active = initial.active;
    if (initial.dirtyFiles) documents.dirtyFiles = initial.dirtyFiles;
    if (initial.revision !== undefined) documents.revision = initial.revision;
  }
  const state = {};
  for (const [key, slice] of ownership) {
    Object.defineProperty(state, key, {
      enumerable: true,
      configurable: false,
      get() {
        if (documents && documentMembers.has(key)) return key === 'files' ? documents.files : documents[key];
        if (builds?.active && buildMembers.has(key)) return builds.active[buildMembers.get(key)];
        if (sessions?.active && sessionMembers.has(key)) {
          if (key === 'debug') return legacyDebug(sessions.active);
          if (key === 'runtimeSession') return sessions.active.identity;
          return sessions.active[key];
        }
        if (key === 'readOnly') {
          if (slices.documents.recoveryReadOnly) return true;
          if (services.locks && documents?.active) {
            return services.locks.isDocumentExecutionLocked?.(documents.active) ?? services.locks.isDocumentLocked(documents.active);
          }
        }
        return slices[slice][key];
      },
      set(value) {
        const previous = state[key];
        if (documents && documentMembers.has(key)) {
          if (key === 'files') documents.replace(value, { discard: true, preserveEditors: true });
          else if (key === 'tabs') documents.tabs = value;
          else documents[key] = value;
        } else if (builds?.active && buildMembers.has(key)) builds.active[buildMembers.get(key)] = value;
        else if (sessions?.active && sessionMembers.has(key)) {
          if (key === 'debug') setLegacyDebug(sessions.active, value);
          else if (key === 'runtimeSession') {
            if (typeof value === 'number') sessions.active.runtimeSession = value;
            else if (value !== sessions.active.identity && value !== undefined && value !== null) throw new Error('Wrong application identity');
          } else {
            sessions.active[key] = value;
            if (key === 'hotEdit') sessions.active.emit('editability');
          }
        } else slices[slice][key] = value;
        if (key === 'recoveryReadOnly') services.locks?.apply();
        if (previous !== value) events.emit({ type: 'changed', slice, key, previous, value });
      }
    });
  }
  services.locks?.setReadOnlyPolicy?.(() => slices.documents.recoveryReadOnly === true);
  return { state, slices, subscribe: (listener, options) => events.subscribe(listener, options), dispose: () => events.dispose() };
}
