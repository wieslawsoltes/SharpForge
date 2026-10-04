import { decodeWorkspaceFile } from '@sharpforge/archive';
import { GitWorkbench } from '../../apps/studio/git-workbench.js';
import { commitStudioWorkspaceRecords } from '../../apps/studio/services/workspace-records.js';
import { createDocumentEvents } from '../../apps/studio/services/documents.js';
import { createRemoteOperations } from '../../packages/git/src/remote-operations.js';
import { studioOperations } from '../../packages/git/src/studio-operations.js';
import { viewFixture, conflictStages } from '../a25-ui-data-fixtures.js';
import { toolsDocument } from '../git-tools/dom.js';
import { temporaryGlobal } from '../git-workspace/fixture.js';

/** Real repository, service queue, workspace adoption and workbench scheduling with an observable transport boundary. */
export async function gitViewFixture(t, { conflict = true } = {}) {
  const data = await viewFixture(t);
  for (const operation of studioOperations) data.service.register(operation);
  for (const operation of createRemoteOperations(null).filter(item => ['head', 'aheadBehind'].includes(item.name))) {
    data.service.register(operation);
  }
  const path = 'image.dat';
  const ours = new Uint8Array([0, 2]);
  if (conflict) await conflictStages(data.repo, path, { base: new Uint8Array([0, 1]), ours, theirs: new Uint8Array([0, 3]) });
  else await data.repo.worktree.write(path, ours);
  const document = toolsDocument();
  const element = document.createElement('div');
  element.isConnected = true;
  element.hidden = true;
  element.classList = { add() {} };
  document.body.append(element);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  temporaryGlobal(t, 'document', document);
  const records = [{ ...decodeWorkspaceFile(path, ours), mode: 0o100644 }];
  const state = { name: 'View fixture', files: [], extraFiles: records, tabs: [], active: '', breakpoints: {}, folders: [],
    revision: 1, diskRevision: 1, workspaceEpoch: 1, workspaceMode: 'folder', configuration: 'Debug', dirtyFiles: new Set(),
    membershipDirty: false, readOnly: false };
  const fixture = { ...data, path, state, element, document, requests: [], toasts: [], mount: { gitMounted: true } };
  const host = {
    getState: () => state, getWorkspaceIdentity: () => 'view-workspace',
    snapshot: () => state.disk?.records ?? records,
    toast: (message, kind) => fixture.toasts.push({ message, kind }), showPanel() {},
    adoptRecords(adopted, options) {
      return commitStudioWorkspaceRecords({ state, editors: new Map(), documentEvents: createDocumentEvents(),
        renderWorkspace: () => fixture.onWorkspaceRender?.(), saveLocal: () => fixture.onSave?.(), scheduleAnalysis() {}
      }, { ...options, records: adopted });
    }
  };
  const changes = await data.repo.status();
  fixture.workbench = Object.assign(Object.create(GitWorkbench.prototype), {
    host, repositoryId: 'ui', repositories: new Map(), mounts: new Map(), ready: Promise.resolve(),
    changes, allChanges: changes, selection: { path }, generation: 0, closed: false, busy: false,
    workspaceBound: true, workspaceIdentity: host.getWorkspaceIdentity(), synced: new Map([[path, ours]]),
    updateStatus() {}, decorateExplorer() {},
    client: { request(method, params, options) {
      const call = { method, params, options, invoke: () => data.run(method, params, options) };
      fixture.requests.push(call);
      return fixture.intercept ? fixture.intercept(call) : call.invoke();
    } }
  });
  fixture.render = () => fixture.workbench.render('git-merge', element, fixture.mount);
  fixture.details = () => data.run('conflictDetail', { path });
  fixture.resolve = async options => {
    const detail = await fixture.details();
    const resolved = await fixture.workbench.request('resolveConflictChoice', {
      path, choice: 'theirs', stagesKey: detail.stagesKey, workingOid: detail.working.oid
    }, options);
    await fixture.workbench.applyResolvedFile(resolved, options);
    return resolved;
  };
  return fixture;
}
