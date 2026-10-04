import {createWorkspaceSave} from '../../apps/studio/workspace-save.js';

/** Explicit callback boundary for the standalone save controller; session integration has its own full host fixture. */
export function workspaceApplication() {
  const state = {files: [], extraFiles: [], folders: [], dirtyFiles: new Set(), readOnly: false,
    revision: 1, workspaceEpoch: 0, saveBusy: false, nativeMode: false, disk: null};
  function replace(records, {disk = state.disk, folders = state.folders, dirty = []} = {}) {
    state.disk = disk;
    state.folders = folders;
    state.files = records.filter(record => /\.cs$/i.test(record.path) && typeof record.text === 'string')
      .map(record => ({uri: record.path, text: record.text, version: record.version ?? 1}));
    state.extraFiles = records.filter(record => !/\.cs$/i.test(record.path) || typeof record.text !== 'string')
      .map(record => ({...record}));
    state.dirtyFiles = new Set(dirty);
    state.revision++;
  }
  const host = {state, nativeBuild: {save: async () => {}}, persistenceReady: async () => {},
    saveLocal() {}, renderWorkspace() {}, renderProject() {}, log() {}, toast() {}};
  host.context = () => ({identity: 'save-host:' + state.workspaceEpoch, disk: state.disk, revision: state.revision,
    readOnly: state.readOnly, fileBusy: state.saveBusy, folders: [...state.folders], dirty: [...state.dirtyFiles],
    records: [...state.files.map(file => ({...state.disk.record(file.uri), path: file.uri, text: file.text, version: file.version})),
      ...state.extraFiles.map(record => ({...record}))]});
  const edit = (path, value) => {
    const record = state.files.find(file => file.uri === path) ?? state.extraFiles.find(file => file.path === path);
    if (typeof value === 'string') record.text = value;
    else record.bytes = value;
    record.version = (record.version ?? 0) + 1;
    state.revision++;
    state.dirtyFiles.add(path);
  };
  const commit = async value => replace(value.records, value);
  const session = {save: createWorkspaceSave(host, commit), load: async (records, options) => {
    replace(records, options);
    state.workspaceEpoch++;
  }};
  return {state, host, edit, session};
}
