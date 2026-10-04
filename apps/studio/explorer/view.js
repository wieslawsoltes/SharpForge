import {storage, storageKeys} from '../settings/storage.js';
import {TreeModel, TreeView} from '@sharpforge/controls';
import {buildSolutionTree, buildLazyFolderTree, remapExplorerState} from '@sharpforge/project-system';
import {ExplorerDragDrop} from './drag-drop.js';
import {ExplorerPersistence} from './persistence.js';
import {ExplorerDiskServices} from './disk-services.js';
import {createExplorerToolbar} from './toolbar.js';
import {explorerViewPolicy} from './view-policy.js';
import {ExplorerChildLoader} from './child-loader.js';
import {revealExplorerPath} from './reveal.js';
import {beginLazyExplorerRestore, restoreLazyExplorerState, cacheLazyExplorerRoots} from './lazy-state.js';

/** Keyed view state survives rebuilds and transaction renames; lazy children are admitted only through expansion. */
export class SolutionExplorer {
  constructor(element, {getData, onOpen, onCommand, onMenu, onProperties, onError}) {
    Object.assign(this, {element, getData, onOpen, onCommand, onMenu, onProperties, onError});
    this.showAll = false;
    this.view = 'solution';
    this.track = true;
    this.nesting = true;
    this.scope = null;
    this.abort = new AbortController();
    this.tree = element.querySelector('#file-tree');
    this.search = element.querySelector('#file-filter');
    this.search.placeholder = 'Search Solution Explorer (Ctrl+;)';
    this.search.setAttribute('aria-label', 'Search Solution Explorer');
    for (const item of element.querySelectorAll('.solution-heading,.project-heading,.dependency-row,.explorer-bottom')) item.hidden = true;
    this.toolbar = createExplorerToolbar(this);
    element.prepend(this.toolbar);
    this.caption = element.ownerDocument.createElement('div');
    this.caption.className = 'explorer-caption';
    this.caption.setAttribute('role', 'status');
    this.tree.before(this.caption);
    this.model = new TreeModel();
    this.childLoader = new ExplorerChildLoader({model: this.model, signal: this.abort.signal, onUpdate: ({reveal}) => {
      cacheLazyExplorerRoots(this);
      if (reveal) this.control.ensureVisible();
    }});
    this.unsubscribe = this.model.subscribe(() => this.saveState());
    this.control = new TreeView(this.tree, {model: this.model, label: 'Solution Explorer',
      onOpen: node => this.safe(() => node.kind === 'load-more' ? this.loadMore(node) : this.onOpen(node)),
      onSelect: (nodes, node, event) => this.select(nodes, node, event),
      onContextMenu: ({node, selection, event, anchor, x, y}) => this.context(node, selection,
        {clientX: x ?? event.clientX, clientY: y ?? event.clientY, currentTarget: this.tree, target: anchor ?? event.target}),
      onCommand: (command, node, nodes) => this.safe(() => this.onCommand(command, node, nodes)),
      onDrop: (nodes, target, {copy}) => this.onCommand(copy ? 'copy-to' : 'move-to', target, nodes),
      onExpand: node => this.expand(node), onError});
    this.dragDrop = new ExplorerDragDrop({element: this.tree, model: this.model, treeId: this.control.id, onCommand, onError});
    this.persistence = new ExplorerPersistence({getData, onCommand,
      onWarning: warning => { this.recoveryWarning = warning.message; this.updateCaption(); }, onChange: () => this.updateCaption()});
    this.diskServices = new ExplorerDiskServices(this);
    this.search.oninput = () => { this.model.setFilter(this.search.value); this.updateCaption(); };
    this.search.onkeydown = event => this.searchKey(event);
    this.backgroundMenu = event => {
      if (!event.defaultPrevented && !this.tree.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        this.context(this.selected()[0] ?? this.model.roots[0], this.selected(), event);
      }
    };
    this.treeMenu = event => {
      if (event.target === this.tree || event.target.classList.contains('sf-tree-canvas')) {
        event.preventDefault();
        event.stopPropagation();
        this.context(this.model.roots[0], [], event);
      }
    };
    this.redoKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.safe(() => this.onCommand('redo', this.selected()[0], this.selected()));
      }
    };
    element.addEventListener('contextmenu', this.backgroundMenu);
    this.tree.addEventListener('contextmenu', this.treeMenu);
    this.tree.addEventListener('keydown', this.redoKey, true);
  }

  safe(action) { return Promise.resolve().then(action).catch(error => this.onError?.(error)); }
  selected() { return this.model.selectionRoots().map(id => this.model.nodes.get(id)); }
  context(node, nodes, event) { return this.onCommand('context', node, nodes, event); }

  canReleaseDocument(path) {
    return this.persistence.canReleaseDocument(path) && !this.diskServices.reload?.pending.has(path);
  }

  /** The session has replaced the source with lazy metadata; release recovery/search view references to its old contents. */
  releaseDocument(path) {
    this.persistence.releaseDocument(path);
    this.diskServices.observe(this.getData());
  }

  select(nodes, node, event) {
    this.onProperties?.(nodes);
    if (node && ['source', 'generated'].includes(node.kind) && !event?.ctrlKey && !event?.metaKey && !event?.shiftKey && event?.type === 'click') {
      this.safe(() => this.onOpen(node, {preview: true}));
    }
  }

  searchKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.search.value = '';
      this.model.setFilter('');
      this.tree.focus();
      this.updateCaption();
    } else if (event.key === 'ArrowDown') { event.preventDefault(); this.tree.focus(); }
  }

  saveState() {
    if (!this.key || this.restoring || this.lazyStateRestore) return;
    try {
      storage.setItem(storageKeys.explorer + this.key, JSON.stringify({version: 1, tree: this.model.snapshot(),
        view: this.view, showAll: this.showAll, track: this.track, nesting: this.nesting}));
    } catch (error) { this.recoveryWarning = 'Explorer state could not be saved: ' + error.message; }
  }

  loadState(data, key) {
    this.key = key;
    this.scope = null;
    this.lazyStateRestore = null;
    this.search.value = '';
    let saved;
    try { saved = JSON.parse(storage.getItem(storageKeys.explorer + key)); }
    catch (error) { this.recoveryWarning = 'Explorer recovery state is corrupt: ' + error.message; }
    this.showAll = saved?.showAll ?? false;
    this.view = saved?.view ?? (data.mode === 'folder' ? 'folders' : 'solution');
    this.track = saved?.track ?? true;
    this.nesting = saved?.nesting ?? true;
    this.model.expanded.clear();
    this.model.selected.clear();
    this.model.seen = new Set();
    return saved;
  }

  render(force = false) {
    const data = this.getData();
    const key = data.identity ?? data.name;
    this.restoring = true;
    const saved = key !== this.key ? this.loadState(data, key) : null;
    const pending = this.lazyStateRestore;
    const retained = pending?.revision === this.model.revision && pending.scope === this.scope && pending.disk === data.disk ? pending : null;
    const oldNodes = retained?.nodes ?? this.model.nodes;
    const previousLazyTree = this.lazyTree?.model;
    const previous = retained?.snapshot ?? this.model.snapshot();
    const scrollTop = retained?.scrollTop ?? this.tree.scrollTop;
    const mappingGroups = [...(retained?.mappingGroups ?? []), this.pendingMappings ?? []];
    const files = data.records ?? data.files ?? [];
    this.viewPolicy = explorerViewPolicy(data, this.view);
    let roots;
    if (this.viewPolicy.lazy) {
      const identity = [key, data.revision, this.viewPolicy.view, this.showAll].join(':');
      if (force || identity !== this.lazyIdentity || data.disk !== this.lazyDisk) {
        this.lazyTree?.model.dispose();
        this.lazyIdentity = identity;
        this.lazyDisk = data.disk;
        this.lazyTree = buildLazyFolderTree({files, folders: data.folders, name: data.name, pageSize: 100, deferIndex: true,
          caseSensitive: data.provider?.capabilities?.caseSensitive ?? true});
      }
      roots = this.lazyTree.roots;
    } else {
      this.lazyTree?.model.dispose();
      this.lazyTree = null;
      roots = buildSolutionTree({...data, files, showAll: this.showAll, view: this.viewPolicy.view,
        nesting: this.nesting, expanded: this.model.expanded});
    }
    const restoreLazy = this.lazyTree && (previousLazyTree !== this.lazyTree.model || retained);
    if (!restoreLazy) this.lazyStateRestore = null;
    if (this.scope) {
      const find = node => node.id === this.scope ? node : (node.children ?? []).map(find).find(Boolean);
      const scoped = roots.map(find).find(Boolean);
      if (scoped) roots = [scoped];
      else if (!restoreLazy) this.scope = null;
    }
    this.tree.setAttribute('aria-busy', String(!!data.fileBusy));
    this.toolbar.querySelector('[data-explorer-action="add"]').disabled = !!data.fileBusy || !!data.readOnly;
    this.model.setNodes(roots);
    this.model.setFilter(this.search.value);
    if (!restoreLazy && this.pendingMappings?.length) {
      this.model.restore(remapExplorerState(previous, oldNodes, this.model.nodes, this.pendingMappings));
    } else if (!restoreLazy && saved?.tree) {
      try { this.model.restore(saved.tree); }
      catch (error) { this.recoveryWarning = 'Explorer state was invalid: ' + error.message; }
    }
    this.pendingMappings = [];
    this.restoring = false;
    this.tree.scrollTop = scrollTop;
    this.allButton.setAttribute('aria-pressed', String(this.showAll));
    this.viewButton.setAttribute('aria-pressed', String(this.viewPolicy.view === 'folders'));
    this.viewButton.disabled = this.viewPolicy.large;
    this.viewButton.title = this.viewPolicy.reason ?? 'Switch Solution / Folder View';
    this.viewButton.setAttribute('aria-label', this.viewButton.title);
    const activeChanged = data.active !== this.lastActive || (retained?.trackActive && retained.active === data.active);
    if (restoreLazy) {
      this.restoreLazyView({snapshot: saved?.tree ?? previous, nodes: oldNodes, saved: !!saved?.tree,
        mappingGroups, scrollTop, active: data.active, trackActive: activeChanged});
    } else if (this.track && activeChanged) {
      this.safe(() => this.reveal(data.active, false));
    }
    this.lastActive = data.active;
    for (const id of restoreLazy ? [] : this.model.expanded) {
      const node = this.model.nodes.get(id);
      if (node?.loadChildren && !node.children.length) this.safe(() => this.expand(node));
    }
    this.updateCaption();
    this.saveState();
    this.persistence.observe(data);
    this.diskServices.observe(data);
  }

  restoreLazyView(options) {
    const rootId = this.lazyTree.model.root.id;
    let snapshot = options.snapshot;
    if (!options.saved && !options.nodes.has(rootId)) snapshot = {...snapshot, expanded: [...snapshot.expanded, rootId]};
    const plan = beginLazyExplorerRestore(this, {...options, snapshot, scope: this.scope, query: this.search.value});
    this.lazyRestoreTask = this.safe(async () => {
      if (await restoreLazyExplorerState(this, plan) && this.track && plan.trackActive && this.getData().active === plan.active) {
        await this.reveal(plan.active, false);
      }
    });
  }

  expand(node) { return this.childLoader.expand(node); }

  loadMore(node) { return this.childLoader.loadMore(node); }

  async expandAll() {
    const nodes = [...this.model.nodes.values()];
    for (const node of nodes) if (node.loadChildren) await this.expand(node);
    this.model.expandAll(true);
  }

  prepareMappings(mappings) { this.pendingMappings = mappings; }
  remapSelection() { this.control.ensureVisible(); }

  updateCaption() {
    const data = this.getData();
    const matches = this.model.query ? this.model.rows().filter(row => row.match).length : null;
    const conflicts = this.persistence?.conflicts?.conflicts.size ?? 0;
    this.caption.textContent = (data.native ? 'Native disk workspace' : 'Browser workspace') + (this.scope ? ' · scoped' : '') +
      (this.viewPolicy?.large ? ' · Large workspace · paged Folder view' : '') +
      (matches !== null ? ' · ' + matches + ' matches' : '') + (conflicts ? ' · ' + conflicts + ' document conflicts' : '');
    const detail = this.recoveryWarning ?? (data.native ? 'File changes are checked against disk before saving.' :
      'File operations support undo/redo. Recovery checkpoints retain text and binary files when OPFS is available.');
    this.caption.title = [this.viewPolicy?.reason, detail].filter(Boolean).join(' ');
  }

  reveal(path, focus = false) { return revealExplorerPath(this, path, focus); }

  scopeTo(node) {
    this.lazyStateRestore = null;
    this.scope = node.id;
    this.render();
    this.model.expand(node.id);
    this.safe(() => this.expand(this.model.nodes.get(node.id)));
    this.tree.focus();
  }

  snapshot() {
    return {...this.model.snapshot(), view: this.viewPolicy?.view ?? this.view, requestedView: this.view,
      showAll: this.showAll, scope: this.scope,
      rows: this.model.rows().map(row => ({id: row.id, label: row.node.label, path: row.node.path, kind: row.node.kind, level: row.level})),
      rendered: this.control.rendered};
  }

  dispose() {
    this.abort.abort();
    this.unsubscribe();
    this.dragDrop.dispose();
    this.persistence.dispose();
    this.diskServices.dispose();
    this.lazyTree?.model.dispose();
    this.control.dispose();
    this.element.removeEventListener('contextmenu', this.backgroundMenu);
    this.tree.removeEventListener('contextmenu', this.treeMenu);
    this.tree.removeEventListener('keydown', this.redoKey, true);
    this.toolbar.remove();
    this.caption.remove();
  }
}
