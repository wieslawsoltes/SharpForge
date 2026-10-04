import {createWorkspaceSession, workspaceContext} from '../../apps/studio/workspace-session.js';
import {StudioSave} from '../../apps/studio/workbench/studio-save.js';
import {studioLoaderFixture} from './studio-loader-fixture.js';
import {readProviderDirectory} from '@sharpforge/project-system';
import {FileSystemAccessProvider, WorkspaceSaveLocks} from '@sharpforge/workspace';
import {memoryDirectory} from './memory-directory-handle.js';

/** The compatibility facade and incoming document services share one real adoption/save host. */
export function studioWorkspaceFixture(t, saveOptions = {}) {
  const fixture = studioLoaderFixture(t);
  const {state, context, services} = fixture;
  const documents = services.documents;
  const nativeBuild = Object.assign(context.nativeBuild, {settings: {}, buffers: new Map(), sourceChanges: () => []});
  const host = {
    state, documents, nativeBuild, editors: documents.editors, workbench: () => context,
    settings: () => ({...context.sessionRecovery.export(), name: state.name, mode: state.workspaceMode,
      entry: state.projectSystem?.solution?.path, startup: state.startupProject ?? undefined,
      active: state.active, tabs: state.tabs, breakpoints: state.breakpoints, configuration: state.configuration}),
    saveLocal: context.saveLocal, renderWorkspace: context.renderWorkspace, renderProject() {},
    persistenceReady: async () => {}, toast() {}, log() {},
    isDocumentOpen: uri => documents.tabs.includes(uri), canReleaseDocument: () => true,
    releaseDocumentCaches() {}, releaseCompilerDocuments: async () => {}, renderDocuments() {}
  };
  context.workspaceSettings = host.settings;
  host.context = () => workspaceContext(state, {nativeBuild, documents, explorerActions: {}, settings: host.settings()});
  const session = createWorkspaceSession(host);
  const saves = new StudioSave({documents, state: () => state, nativeBuild: () => nativeBuild,
    saveRecovery: context.saveLocal, canRecover: () => true, notify() {}, refresh() {},
    saveWorkspace: options => session.save(options), ...saveOptions});
  t.after(() => { saves.dispose(); session.dispose(); });
  return {...fixture, documents, nativeBuild, host, session, saves};
}

/** Real provider permissions, physical hashing and save locks compose with the real document owner. */
export async function studioDiskFixture(t, {files = [['A.cs', 'class A {}']], beforeClose, saveOptions} = {}) {
  let armed = false;
  const writes = [];
  const root = memoryDirectory({beforeClose: async (path, bytes) => {
    if (!armed) return;
    await beforeClose?.(path, bytes);
    writes.push(path);
  }});
  const provider = new FileSystemAccessProvider(root);
  for (const [path, value] of files) {
    await provider.writeFile(path, typeof value === 'string' ? new TextEncoder().encode(value) : value);
  }
  const disk = await readProviderDirectory(root, {provider});
  disk.saveLocks = new WorkspaceSaveLocks({identity: 'studio-source-save',
    locks: {request: (_name, _options, action) => action()}});
  const fixture = studioWorkspaceFixture(t, saveOptions);
  await fixture.session.load(disk.records, {disk, mode: 'folder', updateOnly: true});
  armed = true;
  return {...fixture, disk, provider, root, writes};
}
