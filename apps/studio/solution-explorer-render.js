import {storage, storageKeys} from './settings/storage.js';
import {SolutionExplorerProjection} from './solution-explorer-projection.js';

function workspaceState(explorer, data) {
  const key = data.identity ?? data.name;
  if (key === explorer.key) return null;
  explorer.restoring = true;
  explorer.key = key;
  explorer.scope = null;
  explorer.search.value = '';
  let saved;
  try { saved = JSON.parse(storage.getItem(storageKeys.explorer + key)); } catch {}
  explorer.showAll = saved?.showAll ?? false;
  explorer.view = saved?.view ?? (data.mode === 'folder' ? 'folders' : 'solution');
  explorer.track = saved?.track ?? true;
  explorer.model.expanded.clear();
  explorer.model.selected.clear();
  explorer.model.seen = new Set();
  explorer.projection?.reset();
  return saved;
}

function attribute(element, name, value) {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

/** Keep navigation and workspace chrome current even when the hierarchy is reused. */
export function renderSolutionExplorer(explorer, force = false) {
  const data = explorer.getData(), saved = workspaceState(explorer, data);
  explorer.projection ??= new SolutionExplorerProjection(explorer.model);
  try {
    const result = explorer.projection.update(data, {
      showAll: explorer.showAll, view: explorer.view, scope: explorer.scope, force
    });
    explorer.scope = result.scope;
    attribute(explorer.tree, 'aria-busy', !!data.fileBusy);
    explorer.toolbar.querySelector('[data-explorer-action="add"]').disabled = !!data.fileBusy || !!data.readOnly;
    explorer.model.setFilter(explorer.search.value);
    if (saved?.tree) {
      try { explorer.model.restore(saved.tree); } catch {}
    }
  } finally {
    explorer.restoring = false;
  }
  attribute(explorer.allButton, 'aria-pressed', explorer.showAll);
  attribute(explorer.viewButton, 'aria-pressed', explorer.view === 'folders');
  if (explorer.track && data.active !== explorer.lastActive) explorer.reveal(data.active, false);
  explorer.lastActive = data.active;
  explorer.updateCaption();
  explorer.saveState();
}
