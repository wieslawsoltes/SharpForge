import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {FileSystemAccessProvider, WorkspaceSaveLocks} from '@sharpforge/workspace';
import {createWorkspaceSession, workspaceContext} from '../../apps/studio/workspace-session.js';
import {memoryDirectory} from './memory-directory-handle.js';

/** Application state fixture composes the real session rather than replacing its commit or dirty-buffer rules. */
export function workspaceApplication() {
  const state = {readOnly: false, files: [], extraFiles: [], folders: [], dirtyFiles: new Set(), configuration: 'Debug',
    revision: 1, diskRevision: 0, name: 'Before', active: '', tabs: [], breakpoints: {}, membershipDirty: false};
  const events = [];
  const nativeBuild = {attached: false, settings: {}, buffers: new Map(), sourceChanges: () => []};
  const host = {state, nativeBuild, editors: new Map(), hasNativeChanges: () => false, confirm: () => true,
    selectImport: async () => null, revokeRuntime() {}, stop: async () => {}, savePrevious: () => events.push('previous'),
    resetEditors() {}, renderWorkspace() {}, renderProject() {}, saveLocal: () => events.push('saved-local'),
    log() {}, projectErrors: () => [], applyAnalysis() {}, build: async () => events.push('build'),
    ready: text => events.push(text), toast: text => events.push(text), scheduleAnalysis() {},
    persistenceReady: async () => {}, settings: () => ({name: state.name})};
  host.context = () => workspaceContext(state, {nativeBuild, explorerActions: {}, settings: host.settings()});
  const edit = (path, value) => {
    const record = state.files.find(file => file.uri === path) ?? state.extraFiles.find(file => file.path === path);
    if (typeof value === 'string') record.text = value;
    else record.bytes = value;
    record.version = (record.version ?? 0) + 1;
    state.revision++;
    state.dirtyFiles.add(path);
  };
  return {state, events, host, edit, session: createWorkspaceSession(host)};
}

export const application = workspaceApplication;

export async function directoryFiles(files, options = {}) {
  const root = memoryDirectory();
  const provider = new FileSystemAccessProvider(root);
  for (const [path, value] of files) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) await provider.createDirectory(parent, {recursive: true});
    await provider.writeFile(path, typeof value === 'string' ? new TextEncoder().encode(value) : value);
  }
  const disk = await readDirectory(root, {...options, provider});
  disk.saveLocks = new WorkspaceSaveLocks({identity: 'test-directory', locks: {request: (_name, _options, action) => action()}});
  return {disk, provider};
}

