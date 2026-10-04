async () => {
  const {ExplorerDiskServices} = await import('/explorer/disk-services.js');
  const {MemoryFileSystemProvider, WorkspaceSaveLocks} = await import('/packages/workspace/src/index.js');
  const {ProviderDiskWorkspace: DiskWorkspace, LazyExplorerTree, decodeWorkspaceFile} = await import('/packages/project-system/src/index.js');
  const {TreeModel, TreeView} = await import('/packages/controls/src/index.js');
  const encode = text => new TextEncoder().encode(text);
  const wait = async predicate => {
    for (let index = 0; index < 200; index++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Browser service condition timed out');
  };
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('open.cs', encode('initial needle'));
  await provider.writeFile('closed.cs', encode('closed needle'));
  const records = new Map([
    ['open.cs', {...decodeWorkspaceFile('open.cs', encode('initial needle')), version: 1}],
    ['closed.cs', {path: 'closed.cs', size: 13, lazy: true}]
  ]);
  const disk = new DiskWorkspace([...records.values()], new Map(), 'Browser services', [],
    [{path: 'con.txt', reason: 'non-portable-path'}], {provider,
      saveLocks: new WorkspaceSaveLocks({identity: 'a24-browser-' + crypto.randomUUID(), locks: navigator.locks})});
  await disk.initializeBaselines();
  const host = document.createElement('section');
  host.innerHTML = '<input aria-label="Test explorer search"><div class="a24-test-tree"></div>';
  document.body.append(host);
  const dirty = new Set();
  let revision = 1;
  let fileBusy = false;
  const commands = [];
  const errors = [];
  const opened = [];
  let service;
  const getData = () => ({disk, provider, revision, fileBusy, records: [...records.values()], dirty: [...dirty], tabs: ['open.cs']});
  const view = {element: host, tree: host.querySelector('div'), search: host.querySelector('input'), getData,
    onError: error => errors.push(error.message), onOpen: node => opened.push(node.path),
    onCommand: async (action, node, nodes, value) => {
      commands.push({action, path: value.path});
      if (action !== 'disk-external-change') return;
      const previous = records.get(value.path);
      if (value.expectedVersion !== undefined && previous?.version !== value.expectedVersion) throw Error('Stale external update');
      if (value.event.oldPath) records.delete(value.event.oldPath);
      if (!value.record) records.delete(value.path);
      else {
        const record = {...value.record, version: (previous?.version ?? 0) + 1};
        records.set(record.path, record);
        disk.replaceRecord(record);
        if (record.hash) disk.baselineHashes.set(record.path, record.hash);
      }
      dirty.delete(value.path);
      revision++;
      service.observe(getData());
    }};
  service = new ExplorerDiskServices(view);
  service.observe(getData());
  await service.opening;
  await service.indexReady;
  if (!host.textContent.includes('con.txt')) throw Error('Rejected import path is not visible');
  const result = await disk.findInFiles('needle');
  if (!result.matches.some(match => match.uri === 'closed.cs' && match.line === 0 && match.start === 7)) {
    throw Error('Closed-file Find in Files did not return language-service coordinates');
  }
  if (!disk.record('closed.cs').lazy) throw Error('Search hydrated the disk document unnecessarily');
  await service.searchPaths('closed');
  const pathButton = host.querySelector('.disk-path-results button');
  if (pathButton?.textContent !== 'closed.cs') throw Error('Closed path missing from explorer search');
  pathButton.click();
  await wait(() => opened.length === 1);
  fileBusy = true;
  await provider.writeFile('open.cs', encode('clean reload'));
  await new Promise(resolve => setTimeout(resolve, 150));
  if (records.get('open.cs').text !== 'initial needle') throw Error('Watcher published partial state while a transaction was busy');
  fileBusy = false;
  await wait(() => records.get('open.cs').text === 'clean reload');
  records.set('open.cs', {...records.get('open.cs'), text: 'saved from Studio', version: records.get('open.cs').version + 1});
  dirty.add('open.cs');
  revision++;
  service.observe(getData());
  const commandCount = commands.length;
  await disk.save([{path: 'open.cs', text: 'saved from Studio'}]);
  await new Promise(resolve => setTimeout(resolve, 150));
  await service.queue;
  if (commands.length !== commandCount || service.reload.pending.size) throw Error('Own save caused an external-change prompt');
  records.set('open.cs', {...records.get('open.cs'), text: 'my unsaved edits', version: records.get('open.cs').version + 1});
  revision++;
  service.observe(getData());
  await provider.writeFile('open.cs', encode('their external edits'));
  await wait(() => host.querySelector('[data-disk-choice="compare"]'));
  if (records.get('open.cs').text !== 'my unsaved edits') throw Error('Dirty source was overwritten');
  host.querySelector('[data-disk-choice="compare"]').click();
  await wait(() => host.querySelectorAll('.disk-change-comparison textarea').length === 2);
  const compared = [...host.querySelectorAll('.disk-change-comparison textarea')].map(node => node.value);
  if (compared[0] !== 'my unsaved edits' || compared[1] !== 'their external edits') throw Error('Compare omitted either version');
  host.querySelector('[data-disk-choice="keep"]').click();
  await wait(() => !service.reload.pending.size);
  if (records.get('open.cs').text !== 'my unsaved edits') throw Error('Keep discarded dirty source');
  if (errors.length) throw Error(errors.join('; '));
  service.dispose();
  if (disk.findInFiles || provider.events.listeners.size) throw Error('Explorer disk lifecycle leaked subscriptions');
  host.remove();
  provider.dispose();

  const files = Array.from({length: 10000}, (_, index) => ({path: 'src/File' + index + '.cs', lazy: true}));
  const samples = [];
  const treeElement = document.createElement('div');
  treeElement.style.height = '480px';
  treeElement.style.overflow = 'auto';
  document.body.append(treeElement);
  for (let index = 0; index < 7; index++) {
    const started = performance.now();
    const tree = new LazyExplorerTree({files, deferIndex: true});
    const constructorMs = performance.now() - started;
    const root = await tree.root.loadChildren();
    const folder = root.nodes[0];
    const model = new TreeModel();
    const control = new TreeView(treeElement, {model});
    const materialize = performance.now();
    const page = await folder.loadChildren({limit: 100});
    model.setNodes(page.nodes);
    const expandMs = performance.now() - materialize;
    const rows = treeElement.querySelectorAll('[data-tree-id]').length;
    if (page.total !== 10000 || page.nodes.length !== 100 || rows > 32) throw Error('Explorer DOM paging is unbounded');
    samples.push({constructorMs, expandMs, rows});
    control.dispose();
    tree.dispose();
  }
  treeElement.remove();
  const ordered = samples.map(sample => sample.expandMs).sort((left, right) => left - right);
  const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
  if (p95 >= 16) throw Error('Explorer page materialization exceeded frame budget: ' + p95 + ' ms');
  return {services: ['visible skipped paths', 'closed-file path and text search', 'clean reload', 'dirty compare and keep',
    'own-save suppression', 'busy-transaction isolation', 'disposal'], backend: 'Chromium DOM with memory provider; Web Locks',
    frameBudgetMs: 16, expandMedianMs: ordered[3], expandP95Ms: p95, samples};
}
