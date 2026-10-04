async () => {
  const {SolutionExplorer} = await import('/explorer/view.js');
  const {storage, storageKeys} = await import('/settings/storage.js');
  const files = [{path: 'App.csproj', lazy: true}, ...Array.from({length: 20000}, (_, index) =>
    ({path: 'src/File' + index + '.cs', lazy: true, size: 10}))];
  let data = {name: 'A24 large solution', identity: 'a24-large-' + crypto.randomUUID(), revision: 1, native: true,
    records: files, snapshot: {projects: [{path: 'App.csproj', compile: files.slice(1)}]}};
  const host = document.createElement('section');
  host.innerHTML = '<input id="file-filter"><div id="file-tree" style="height:480px;overflow:auto"></div>';
  document.body.append(host);
  const errors = [];
  let menu;
  const explorer = new SolutionExplorer(host, {getData: () => data, onError: error => errors.push(error.message),
    onOpen: () => {}, onCommand: () => {}, onMenu: value => { menu = value; }});
  const wait = async predicate => {
    for (let index = 0; index < 300; index++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Large explorer condition timed out: ' + errors.join('; '));
  };
  try {
    const started = performance.now();
    explorer.render();
    const initialRenderMs = performance.now() - started;
    const initialNodes = explorer.model.nodes.size;
    if (initialNodes !== 1 || explorer.lazyTree.model.files.size !== 0) throw Error('Default solution eagerly built the large hierarchy');
    if (explorer.snapshot().view !== 'folders' || explorer.view !== 'solution') throw Error('Automatic folder view changed the saved preference');
    if (!explorer.caption.textContent.includes('Large workspace · paged Folder view')) throw Error('Automatic fallback is not visible');
    if (!explorer.viewButton.disabled || explorer.viewButton.getAttribute('aria-pressed') !== 'true') throw Error('View toolbar state is inconsistent');
    await explorer.toolbar.querySelector('[data-explorer-action="options"]').onclick();
    const solutionChoice = menu.items.find(item => item?.label === 'Solution view');
    if (solutionChoice.enabled !== false || !solutionChoice.disabledReason) throw Error('Unavailable solution choice has no explanation');
    await wait(() => explorer.model.nodes.has('folder:src'));
    const folder = explorer.model.nodes.get('folder:src');
    const expandStarted = performance.now();
    await explorer.expand(folder);
    explorer.model.expand('folder:src', true);
    const expandMs = performance.now() - expandStarted;
    const nodesAfterPage = explorer.model.nodes.size;
    const renderedRows = explorer.tree.querySelectorAll('[data-tree-id]').length;
    if (folder.childCount !== 20000 || nodesAfterPage > 104 || renderedRows > 32) throw Error('Actual Explorer page or DOM row count is unbounded');
    const currentFolder = explorer.model.nodes.get('folder:src');
    const more = currentFolder.children.find(node => node.kind === 'load-more');
    if (!more) throw Error('Large folder has no accessible next-page action');
    await explorer.loadMore(more);
    if (explorer.model.nodes.size > 204) throw Error('Loading one more page materialized remaining files');
    const oldTree = explorer.lazyTree.model;
    data = {...data, revision: 2, records: files.slice(0, 3), snapshot: {projects: [{path: 'App.csproj', compile: files.slice(1, 3)}]}};
    explorer.render();
    if (explorer.snapshot().view !== 'solution' || explorer.viewButton.disabled) throw Error('Smaller scope did not restore Solution view');
    if (!oldTree.disposed || oldTree.files.size) throw Error('Unused deferred tree retained records');
    if (!explorer.model.nodes.has('project:App.csproj')) throw Error('Smaller solution lost its project hierarchy');
    if (errors.length) throw Error(errors.join('; '));
    return {files: 20000, initialNodes, initialRenderMs, expandMs, nodesAfterPage, renderedRows,
      actualComponent: 'SolutionExplorer', fallback: 'visible paged Folder view', savedPreference: 'solution',
      coverage: ['default large project', 'toolbar explanation', 'bounded page', 'load more', 'smaller-scope restoration', 'disposal']};
  } finally {
    explorer.dispose();
    storage.removeItem(storageKeys.explorer + data.identity);
    host.remove();
  }
}
