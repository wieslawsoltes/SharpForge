async ({folderName, initialize}) => {
  console.info('A24 components: loading application modules');
  const {SolutionExplorer} = await import('/explorer/view.js');
  const {ExplorerCommands} = await import('/explorer-commands.js');
  const {createWorkspaceSession, workspaceContext} = await import('/workspace-session.js');
  const {applyWorkspaceConflictResolution} = await import('/workspace-conflicts.js');
  const {applyExternalDiskChange, reevaluateDiskWorkspace} = await import('/workspace-disk-events.js');
  const {promptWorkspaceSaveConflict} = await import('/workspace-save-conflict.js');
  const {FileSystemAccessProvider, OpfsRecoveryStore} = await import('/packages/workspace/src/index.js');
  const {readProviderDirectory: readDirectory} = await import('/packages/project-system/src/index.js');
  const {storage, storageKeys} = await import('/settings/storage.js');
  console.info('A24 components: opening physical OPFS folder');
  const root = await navigator.storage.getDirectory();
  const handle = await root.getDirectoryHandle(folderName, {create: true});
  const provider = new FileSystemAccessProvider(handle);
  const original = '// one\n// two\n// three\n';
  if (initialize) {
    for (const [path, value] of [['A.cs', original], ['Closed.cs', 'class Closed {}'], ['raw.bin', Uint8Array.of(0, 128, 255)]]) {
      await provider.writeFile(path, typeof value === 'string' ? new TextEncoder().encode(value) : value);
    }
  }
  const disk = await readDirectory(handle, {provider, lazy: true, openedPaths: ['A.cs', 'raw.bin']});
  console.info('A24 components: constructing isolated session and explorer');
  const element = document.createElement('section');
  element.id = 'a24-integrity-components';
  element.style.cssText = 'position:fixed;inset:30px 40px;background:var(--bg,#222);z-index:900;overflow:auto';
  element.innerHTML = '<h2>Workspace component qualification</h2><input id="file-filter">' +
    '<div id="file-tree" style="height:400px;overflow:auto"></div>';
  document.body.append(element);
  const errors = [], notices = [], messages = [];
  const state = {readOnly: false, files: [], extraFiles: [], folders: [], dirtyFiles: new Set(), configuration: 'Debug',
    revision: 1, diskRevision: 0, name: folderName, active: '', tabs: [], breakpoints: {}, membershipDirty: false};
  const nativeBuild = {attached: false, settings: {}, buffers: new Map(), sourceChanges: () => []};
  let explorer, commands;
  const host = {state, nativeBuild, editors: new Map(), hasNativeChanges: () => false, confirm: () => true,
    selectImport: async () => null, revokeRuntime() {}, stop: async () => {}, savePrevious() {}, resetEditors() {},
    renderWorkspace: () => explorer?.render(), renderProject() {}, saveLocal() {}, log() {},
    projectErrors: () => [], applyAnalysis() {}, build: async () => {}, ready() {}, toast() {}, scheduleAnalysis() {},
    persistenceReady: () => explorer?.persistence.ready(), settings: () => ({name: state.name, active: state.active, tabs: state.tabs})};
  host.context = () => workspaceContext(state, {nativeBuild, explorerActions: commands ?? {}, settings: host.settings()});
  const session = createWorkspaceSession(host);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const ask = (title, content, label, answer) => new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<h2>${escapeHtml(title)}</h2>${content}`;
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    const accept = document.createElement('button');
    accept.textContent = label;
    accept.onclick = () => finish(answer());
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => finish(null);
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.append(accept, cancel);
    document.body.append(dialog);
    dialog.showModal();
  });
  host.chooseSaveConflict = value => promptWorkspaceSaveConflict({ask, query: selector => document.querySelector(selector), escapeHtml}, value);
  const actions = {
    'disk-external-change': payload => applyExternalDiskChange(host, session, payload),
    'disk-reevaluate': payload => reevaluateDiskWorkspace(host, session, payload)
  };
  commands = new ExplorerCommands({context: host.context, commit: session.commit, render: () => explorer?.render(),
    error: error => errors.push(error.message), notice: message => notices.push(message),
    applyConflictResolution: resolution => applyWorkspaceConflictResolution(host, session, resolution),
    pathDialog: async () => fixture.nextPath, confirm: async () => true, choose: async () => null,
    refresh: () => explorer.render(), open: async node => { state.active = node.path; },
    workspaceAction: (action, _node, payload) => {
      if (!actions[action]) throw Error('Unknown fixture workspace action: ' + action);
      return actions[action](payload);
    }});
  await session.load(disk.records, {disk, mode: 'folder', name: folderName, settings: {active: 'A.cs', tabs: ['A.cs']}});
  explorer = new SolutionExplorer(element, {getData: host.context, onOpen: node => commands.host.open(node),
    onCommand: (...args) => commands.run(...args), onError: error => errors.push(error.message), onMenu() {}, onProperties() {}});
  commands.host.explorer = explorer;
  const fixture = {state, host, session, explorer, commands, disk, provider, errors, notices, messages, original, element,
    record(path = 'A.cs') { return host.context().records.find(record => record.path === path); },
    edit(text) {
      const file = state.files.find(file => file.uri === 'A.cs');
      file.text = text;
      file.version++;
      state.revision++;
      state.dirtyFiles.add('A.cs');
      explorer.render();
    },
    async checkpoint() { await explorer.persistence.checkpoint(host.context()); },
    async physical(path = 'A.cs') { return new TextDecoder().decode(await provider.readFile(path)); },
    async resolve(choice) {
      await explorer.persistence.prepareConflict('A.cs');
      const result = await explorer.persistence.resolve('A.cs', choice);
      await fixture.checkpoint();
      return result;
    },
    async startBarrier() {
      let entered;
      const ready = new Promise(resolve => { entered = resolve; });
      fixture.barrier = disk.saveLocks.run('', async () => {
        const held = new Promise(resolve => { fixture.releaseBarrier = resolve; });
        entered();
        await held;
      }, {workspace: true});
      await ready;
    },
    startSave() {
      fixture.saveOutcome = null;
      fixture.savePromise = session.save().then(result => { fixture.saveOutcome = {status: 'saved', result}; }, error => {
        fixture.saveOutcome = {status: 'conflict', message: error.message, code: error.code, cause: error.cause?.code};
      });
    },
    async stageSave(mine, theirs) {
      fixture.edit(mine);
      await provider.writeFile('A.cs', new TextEncoder().encode(theirs));
      fixture.startSave();
    },
    async recovery() {
      await fixture.checkpoint();
      const record = (await explorer.persistence.store.load()).record;
      const closed = record.records.find(file => file.path === 'Closed.cs');
      const binary = record.records.find(file => file.path === 'raw.bin');
      if (!closed.lazy || closed.text !== undefined || closed.bytes !== undefined) throw Error('Recovery materialized or dropped a lazy member');
      if (binary.bytes.join(',') !== '0,128,255') throw Error('Recovery changed binary bytes');
      const recent = await explorer.persistence.recentFolders();
      const same = recent.find(value => value.identity === explorer.persistence.identity);
      if (!same || !await same.handle.isSameEntry(handle)) throw Error('IndexedDB did not preserve the actual folder handle');
      const reopened = await explorer.persistence.reopenRecent(same.identity);
      if (reopened.readOnly || reopened.permission !== 'granted' || !await reopened.handle.isSameEntry(handle)) {
        throw Error('Granted OPFS recent handle could not reopen');
      }
      const snapshots = await explorer.persistence.recent();
      return {lazyPath: closed.path, size: closed.size, binary: [...binary.bytes], openDocuments: record.openDocuments,
        handleIdentity: same.identity, permission: reopened.permission, snapshots: snapshots.length};
    },
    async quarantine() {
      await fixture.checkpoint();
      clearTimeout(explorer.persistence.timer);
      const current = (await explorer.persistence.store.load()).record;
      const directory = explorer.persistence.store.directory;
      const store = new OpfsRecoveryStore({directory});
      await store.save({...current, savedAt: current.savedAt + 1});
      const manifest = await store.manifest(directory);
      const file = await directory.getFileHandle(manifest.current);
      const stream = await file.createWritable();
      await stream.write('{truncated browser checkpoint');
      await stream.close();
      const restored = await store.load();
      const quarantine = await directory.getDirectoryHandle('quarantine');
      const names = [];
      for await (const [name] of quarantine.entries()) names.push(name);
      if (!restored.recoveredPrevious || !names.some(name => name.endsWith('.report.json'))) throw Error('Corrupt checkpoint was not quarantined');
      if (restored.record.records.find(value => value.path === 'raw.bin').bytes.join(',') !== '0,128,255') {
        throw Error('Previous physical recovery generation lost bytes');
      }
      store.dispose();
      return {recoveredPrevious: restored.recoveredPrevious, files: names, diagnostics: restored.diagnostics};
    },
    async dispose() {
      fixture.releaseBarrier?.();
      await fixture.barrier;
      clearTimeout(explorer.persistence.timer);
      await explorer.persistence.saving;
      const identity = explorer.persistence.identity;
      await explorer.persistence.handles.forget(identity);
      commands.dispose();
      explorer.dispose();
      storage.removeItem(storageKeys.explorer + host.context().identity);
      element.remove();
    }
  };
  window.__a24Components = fixture;
  explorer.render();
  console.info('A24 components: awaiting persistent folder identity');
  await explorer.persistence.revisionQueue;
  await explorer.expand(explorer.model.roots[0]);
  explorer.model.expandAll(true);
  explorer.reveal('A.cs', true);
  const persistence = explorer.persistence;
  persistence.channel.channel.addEventListener('message', event => {
    if (event.data.kind !== 'revision' || event.data.path !== 'A.cs') return;
    const conflict = persistence.conflicts.conflicts.get('A.cs');
    messages.push({hash: event.data.hash, staleDuringMessage: !!conflict,
      captionDuringMessage: explorer.caption.textContent, textDuringMessage: fixture.record()?.text});
    if (messages.length > 32) messages.shift();
  });
  await fixture.checkpoint();
  console.info('A24 components: ready');
  return {identity: persistence.identity, records: disk.records.length, lazy: disk.records.filter(record => record.lazy).length};
}
