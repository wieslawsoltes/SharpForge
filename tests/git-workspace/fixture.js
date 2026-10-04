import { GitError } from '@sharpforge/git';
import { GitWorkbench } from '../../apps/studio/git-workbench.js';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

export function temporaryGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

/** Host controls are a fixture; scheduling, request options, clone and binding use the actual GitWorkbench methods. */
export function workspaceFixture({ native = false } = {}) {
  const state = { files: [{ uri: 'Original.cs', text: 'class Original {}\n', version: 1 }], revision: 1, diskRevision: 1,
    workspaceEpoch: 1, nativeMode: false, dirtyFiles: new Set(), membershipDirty: false, readOnly: false };
  const fixture = { state, identity: 'workspace-original', events: [], calls: [], adoptions: [], nativeTickets: [],
    records: [{ path: 'Original.cs', text: state.files[0].text, mode: 0o100644 }],
    files: [{ path: 'Prepared.cs', data: new TextEncoder().encode('class Prepared {}\n'), mode: 0o100644 }] };
  const host = fixture.host = {
    getState: () => state,
    getWorkspaceIdentity: () => fixture.identity,
    snapshot: () => fixture.records,
    showPanel: id => fixture.events.push(['panel', id]),
    toast: (message, kind) => fixture.events.push(['toast', message, kind]),
    async adoptRecords(records, options) {
      fixture.adoptions.push(options);
      options.validate();
      fixture.records = records;
      state.files = records.filter(record => record.path.endsWith('.cs')).map(record => ({ ...record, uri: record.path }));
      state.revision++;
      state.diskRevision++;
      if (options.openWorkspace) { state.workspaceEpoch++; fixture.identity = `workspace-${state.workspaceEpoch}`; }
      options.onCommitted();
      return { adopted: true };
    }
  };
  if (native) host.beginWorkspaceLoad = ({ signal }) => {
    const revision = state.revision;
    const identity = fixture.identity;
    const ticket = { signal, finishes: 0, check() {
      if (state.readOnly || state.revision !== revision || fixture.identity !== identity) throw new GitError('Conflict', 'Native capture changed');
    }, finish() {
      ticket.finishes++;
      if (Object.hasOwn(fixture, 'finishError')) throw fixture.finishError;
    } };
    fixture.nativeTickets.push(ticket);
    fixture.events.push(['begin']);
    return ticket;
  };
  const workbench = fixture.workbench = Object.create(GitWorkbench.prototype);
  Object.assign(workbench, {
    host, repositoryId: 'original', repositories: new Map([['original', { repositoryId: 'original', open: true }]]),
    workspaceBound: true, workspaceIdentity: fixture.identity, busy: false, ready: Promise.resolve(),
    synced: new Map([['Original.cs', new TextEncoder().encode(state.files[0].text)]]), changes: [], allChanges: [],
    credentialIds: new Map(), collaboration: { dispose() {} }, mounts: new Map(),
    updateStatus() {}, async renderMounted() {}, async refresh() {},
    explorerObserver: { disconnect() {} }, worker: { terminate() { fixture.events.push(['terminate']); } },
    preferences: { model: { values: { defaultBranch: 'main', userName: '', userEmail: '' } },
      saveRepositories() {}, async networkParameters(remote) { return { url: remote.url, anonymous: true }; } },
    client: { async request(method, params, options) {
      fixture.calls.push({ method, params, options });
      const result = await fixture.onRequest?.(method, params, options);
      if (result !== undefined) return result;
      if (method === 'files') return fixture.files;
      if (method === 'init' || method === 'open') return { repositoryId: params.repositoryId, name: 'Prepared', algorithm: 'sha1' };
      return {};
    }, async dispose() {} }
  });
  fixture.edit = text => {
    fixture.records[0].text = text;
    state.files[0].text = text;
    state.files[0].version++;
    state.revision++;
    state.diskRevision++;
  };
  return fixture;
}
