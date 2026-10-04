/** Accessible explorer toolbar. Buttons share the same commands as context menus and keyboard actions. */
export function createExplorerToolbar(explorer) {
  const document = explorer.element.ownerDocument;
  const toolbar = document.createElement('div');
  toolbar.className = 'explorer-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Solution Explorer');
  const button = (id, title, text, action) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.title = title;
    element.setAttribute('aria-label', title);
    element.dataset.explorerAction = id;
    element.textContent = text;
    element.onclick = () => explorer.safe(action);
    toolbar.append(element);
    return element;
  };
  button('home', 'Home — entire solution', '⌂', () => {
    explorer.scope = null;
    explorer.search.value = '';
    explorer.render();
    explorer.model.reveal(explorer.model.focused, {select: false});
    explorer.control.ensureVisible();
  });
  button('sync', 'Sync with Active Document', '⇥', () => explorer.reveal(explorer.getData().active, true));
  button('collapse', 'Collapse All', '⊟', () => {
    explorer.model.expandAll(false);
    explorer.tree.scrollTop = 0;
    explorer.tree.focus();
  });
  button('refresh', 'Refresh workspace', '↻', () => explorer.onCommand('refresh', null, []));
  explorer.allButton = button('show-all', 'Show All Files', '▧', () => { explorer.showAll = !explorer.showAll; explorer.render(true); });
  explorer.viewButton = button('view', 'Switch Solution / Folder View', '▰', () => {
    explorer.view = explorer.view === 'solution' ? 'folders' : 'solution';
    explorer.scope = null;
    explorer.render(true);
  });
  button('add', 'Add new item', '＋', () => explorer.onCommand('new-file', explorer.selected()[0], explorer.selected()));
  button('options', 'Explorer options', '⌄', () => {
    const bounds = toolbar.getBoundingClientRect();
    const refresh = action => { action(); explorer.render(true); };
    const view = explorer.viewPolicy?.view ?? explorer.view;
    explorer.onMenu({x: bounds.right - 220, y: bounds.bottom, anchor: toolbar.lastChild, document, items: [
      {label: 'Track Active Item', checked: explorer.track, action: () => { explorer.track = !explorer.track; explorer.saveState(); }},
      {label: 'Show All Files', checked: explorer.showAll, action: () => refresh(() => { explorer.showAll = !explorer.showAll; })},
      {label: 'File Nesting', checked: explorer.nesting, action: () => refresh(() => { explorer.nesting = !explorer.nesting; })},
      {label: 'Solution view', radio: true, checked: view === 'solution', enabled: !explorer.viewPolicy?.large,
        disabledReason: explorer.viewPolicy?.reason,
        action: () => refresh(() => { explorer.view = 'solution'; explorer.scope = null; })},
      {label: 'Folder view', radio: true, checked: view === 'folders',
        action: () => refresh(() => { explorer.view = 'folders'; explorer.scope = null; })}, null,
      {label: 'Expand All', action: () => explorer.expandAll()}, {label: 'Collapse All', action: () => explorer.model.expandAll(false)},
      {label: 'Restore Workspace Recovery…', action: () => explorer.onCommand('restore-recovery')},
      {label: 'Request Persistent Recovery Storage', action: () => explorer.persistence.store?.requestPersistence()}
    ]});
  });
  return toolbar;
}
