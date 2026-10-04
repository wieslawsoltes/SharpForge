import { EditorModel } from '../../packages/editor/src/index.js';
import { createWorkbenchServices } from '../../apps/studio/workbench/sessions.js';
import { StudioProjects } from '../../apps/studio/workbench/studio-projects.js';
import { StudioExecution } from '../../apps/studio/workbench/studio-execution.js';
import { SessionRecovery } from '../../apps/studio/workbench/session-recovery.js';
import { readStudioSource } from '../../apps/studio/workbench/studio-source-reader.js';
import { WorkspaceLoads } from '../../apps/studio/workbench/workspace-loads.js';
import { fakeWorkers, compileResult } from '../a19-session-fixtures.js';

export function studioLoaderFixture(t) {
  const calls = { stopped: 0, previous: 0, saved: 0, rendered: 0, statuses: [], errors: [] };
  const fake = fakeWorkers(() => compileResult());
  let projects;
  const services = createWorkbenchServices({ workerFactory: fake.factory,
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }),
    getProjectSnapshot: id => projects.snapshot(id) });
  const state = services.createStateFacade({ files: [{ uri: 'Old.cs', text: '// old source', version: 1 }],
    name: 'Old workspace', active: 'Old.cs', tabs: ['Old.cs'], nativeMode: false, readOnly: false,
    workspaceEpoch: 1, workspaceMode: 'folder', configuration: 'Debug', extraFiles: [], folders: [],
    projectSystem: null, projectSnapshot: null, startupProject: null, disk: null, diskRevision: 0,
    revision: 1, breakpoints: {}, functionBreakpoints: [], membershipDirty: false, langVersion: '14' });
  projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  const status = value => calls.statuses.push(value);
  const execution = new StudioExecution({ services, projects, state: () => state, ui: {
    status, error: error => calls.errors.push(error), refresh() {}, applyAnalysis() {}, setPanel() {}
  } });
  const context = {
    workspaceLoads: new WorkspaceLoads(),
    state, documents: services.documents, projectServices: projects, nativeBuild: { attached: false },
    sessionRecovery: new SessionRecovery(services), runtimeBridge: { select() {} }, readSource: readStudioSource,
    projectWizard: { selectImport: async () => ({ mode: 'folder' }) }, confirmLeaveNative: () => true,
    stopQuietly: async () => { calls.stopped++; await services.sessions.stopAll(); },
    savePrevious: () => calls.previous++, currentWorkspaceMetadata: () => ({ name: state.name }),
    resetEditors: () => services.documents.resetEditors(),
    renderWorkspace: () => { projects.sync(); calls.rendered++; }, renderPanel() {},
    saveLocal: () => { calls.saved++; return true; }, log() {}, projectErrors: () => [],
    applyAnalysis() {}, build: silent => execution.build(silent), status, renderTree() {}
  };
  t.after(() => { context.workspaceLoads.dispose(); services.dispose(); });
  return { services, state, fake, calls, context };
}
