import { storage, storageKeys } from '../settings/storage.js';
import { toolDefinitions } from '../tools/definitions.js';
import { DockLayout, DockHost, migrateLayout } from '@sharpforge/docking';
import { defaultDockLayout, presetDockLayout } from './layout-defaults.js';
import { DocumentTabs, confirmDirtyDocuments } from './tabs/index.js';
import { documentTabMenu } from './tabs/menu.js';
import { WorkbenchNavigation } from './navigation/index.js';
import { WindowManagement } from './window-management/index.js';
import { WindowLayouts } from './layout-management/index.js';
import { ToolWindowFactories } from './window-factories.js';
export { toolDefinitions } from '../tools/definitions.js';
export { defaultDockLayout } from './layout-defaults.js';

export class StudioDocking {
  constructor({ createDocument, onActivate = () => {}, onError = () => {}, onClose = () => {}, onWindowKeyDown, onPopoutDocument } = {}) {
    const root = document.querySelector('#workspace');
    const solution = document.querySelector('#solution');
    const diagnostics = document.querySelector('#diagnostic-tools');
    const breadcrumb = document.querySelector('.editor-breadcrumb');
    this.content = new Map([['solution', solution], ['diagnostics', diagnostics]]);
    this.createDocument = createDocument;
    this.onActivate = onActivate;
    this.onError = onError;
    this.onClose = onClose;
    this.pendingRestore = null;
    this.documentViewsReset = false;
    try { this.pendingRestore = storage.getItem(storageKeys.docking); } catch (error) { onError(error); }
    root.before(breadcrumb);
    breadcrumb.classList.add('workspace-breadcrumb');
    const count = document.querySelector('#error-count');
    const summary = document.querySelector('#inline-diagnostics');
    if (count) breadcrumb.append(count);
    if (summary) summary.title = 'Live compiler diagnostics';
    solution.querySelector('.window-title')?.remove();
    diagnostics.querySelector('.window-title')?.remove();
    root.replaceChildren();
    root.classList.add('docked-workspace');
    for (const panel of toolDefinitions) {
      if (this.content.has(panel.id)) continue;
      const element = document.createElement('div');
      element.className = 'panel-content dock-tool-content';
      this.content.set(panel.id, element);
    }
    for (const [id, content] of this.content) content.dataset.tool = id;
    this.layout = new DockLayout(toolDefinitions, defaultDockLayout());
    this.host = new DockHost(root, this.layout, { resolveContent: id => this.resolve(id), onActivate, onError, onClose,
      requestClose: id => this.requestClose(id), onWindowKeyDown,
      onTabDoubleClick: id => this.tabs?.promote(id),
      onPopoutDocument: (child, context) => { this.windows?.attachPopout(child); onPopoutDocument?.(child, context); },
      menuProvider: id => this.tabs?.metadata(id) ? documentTabMenu(this.tabs, id, {
        host: this.host, copyPath: this.copyPath, revealFile: this.revealFile
      }) : null });
    this.factories = new ToolWindowFactories({ layout: this.layout, content: this.content });
    this.persistOff = this.layout.subscribe(() => {
      if (this.restoring) return;
      try { storage.setItem(storageKeys.docking, this.layout.serialize()); } catch (error) { this.onError(error); }
    });
    this.mobile = false;
    this.media = matchMedia('(max-width: 700px)');
    this.mediaListener = () => this.adapt();
    this.media.addEventListener('change', this.mediaListener);
  }

  /** Attaches the shared document service; all close routes now use the same atomic Save/Discard/Cancel flow. */
  attachDocuments(documents, { confirmClose, copyPath, revealFile, confirmReset } = {}) {
    this.tabs?.dispose();
    this.windows?.dispose();
    this.documents = documents;
    this.copyPath = copyPath;
    this.revealFile = revealFile;
    this.tabs = new DocumentTabs({ layout: this.layout, documents,
      confirmClose: confirmClose ?? ((items, options) => confirmDirtyDocuments(this.host.element.ownerDocument, items, options)),
      onActivate: id => this.onActivate(id), onClosed: id => {
        if (this.host.popouts.has(id)) this.host.returnPopout(id, { reopen: false });
        this.onClose(id);
      } });
    for (const panel of this.layout.panels.values()) {
      if (panel.id.startsWith('source:')) this.tabs.ensure(panel.id.slice(7));
    }
    this.navigation = new WorkbenchNavigation({ tabs: this.tabs, host: this.host });
    this.layouts = new WindowLayouts({ layout: this.layout, storage, key: storageKeys.layouts, host: this.host,
      reset: () => this.reset(), confirmReset: confirmReset ?? (() => this.host.element.ownerDocument.defaultView.confirm('Reset Window Layout?')),
      onError: this.onError });
    this.windows = new WindowManagement({ host: this.host, tabs: this.tabs, layouts: this.layouts, navigation: this.navigation, onError: this.onError });
    return { tabs: this.tabs, navigation: this.navigation, windows: this.windows, layouts: this.layouts };
  }

  resolve(id) {
    if (this.content.has(id)) return this.content.get(id);
    const view = this.tabs?.metadata(id) ?? (id.startsWith('source:') ? { uri: id.slice(7), viewId: 'primary' } : null);
    if (!view) throw new Error(`No content factory for docking panel '${id}'`);
    const element = this.createDocument(view.uri, { viewId: view.viewId, panelId: id });
    this.content.set(id, element);
    return element;
  }

  sync(files, tabs, active) {
    let selected = this.layout.state.activePanel;
    let selectedView = this.tabs?.metadata(selected);
    const restoring = Boolean(this.pendingRestore);
    const ids = new Set(files.map(file => `source:${file.uri}`));
    let metadataChanged = false;
    // DocumentService has already committed the workspace. No subscriber may render a partly removed old layout.
    const changed = this.layout.transaction('syncDocuments', () => {
      for (const id of [...this.layout.panels.keys()]) {
        const view = this.tabs?.metadata(id);
        if ((id.startsWith('source:') || view) && !ids.has(`source:${view?.uri ?? id.slice(7)}`)) this.unregisterPanel(id);
      }
      for (const file of files) {
        const id = `source:${file.uri}`;
        if (this.tabs) this.tabs.ensure(file.uri);
        else if (!this.layout.panels.has(id)) {
          this.layout.register({ id, title: file.uri.split('/').at(-1), description: file.uri, kind: 'document' });
        }
        const panel = this.layout.require(id);
        const dirty = Boolean(this.documents?.get(file.uri)?.dirty ?? file.dirty);
        metadataChanged ||= Boolean(panel.dirty) !== dirty;
        panel.dirty = dirty;
      }
      if (this.pendingRestore) {
        this.restorePending(files);
        selected = this.layout.state.activePanel;
        selectedView = this.tabs?.metadata(selected);
      }
      for (const uri of tabs) {
        const id = `source:${uri}`;
        if (!ids.has(id) || this.layout.locate(id).kind !== 'closed') continue;
        const group = this.layout.groups().find(item => item.kind === 'document');
        this.layout.open(id, group?.id, { activate: false });
      }
      const preserveActive = (this.documentSyncStarted || restoring) && this.layout.panels.has(selected)
        && this.layout.locate(selected).kind !== 'closed' && (!selectedView || selectedView.uri === active);
      if (!preserveActive && active && this.layout.panels.has(`source:${active}`)) this.layout.open(`source:${active}`);
    }, { history: false });
    this.documentSyncStarted = true;
    const openTabs = new Set(tabs);
    const needsRender = metadataChanged || this.documentViewsReset
      || files.some(file => !this.host.contents.has(`source:${file.uri}`) && openTabs.has(file.uri));
    if (!changed && needsRender) this.host.render();
    this.documentViewsReset = false;
    this.adapt();
  }

  /** Invalidates source views after document replacement; the next sync publishes and renders the complete workspace. */
  resetDocumentViews() {
    const ids = new Set([...this.content.keys(), ...this.host.contents.keys(), ...this.host.popouts.keys()]);
    const sources = [...ids].filter(id => this.tabs?.metadata(id) || id.startsWith('source:'));
    for (const id of sources) {
      if (this.host.popouts.has(id)) this.host.returnPopout(id, { reopen: false, render: false });
    }
    try { this.documents?.resetEditors(); }
    finally {
      for (const id of sources) this.releasePanelContent(id);
      this.documentViewsReset = true;
    }
  }

  restorePending(files) {
    const serialized = this.pendingRestore;
    this.pendingRestore = null;
    this.restoring = true;
    try {
      let snapshot;
      try { snapshot = migrateLayout(serialized); } catch (error) { this.onError(error); }
      if (snapshot) {
        for (const diagnostic of this.factories.restore(snapshot.panelInstances ?? {})) this.onError(Object.assign(new Error(diagnostic.message), diagnostic));
        for (const [id, view] of Object.entries(snapshot.documentViews ?? {})) {
          if (!files.some(file => file.uri === view.uri) || !this.tabs) continue;
          if (view.viewId === 'primary') this.tabs.ensure(view.uri);
          else {
            this.tabs.views.set(id, { uri: view.uri, viewId: view.viewId });
            if (!this.layout.panels.has(id)) this.layout.register({ id, title: `${view.uri.split('/').at(-1)} · ${view.viewId}`,
              description: view.uri, kind: 'document', documentUri: view.uri, viewId: view.viewId });
          }
        }
      }
      const diagnostics = this.layout.restorePersisted(serialized, { viewport: {
        width: this.host.element.clientWidth, height: this.host.element.clientHeight
      } });
      for (const diagnostic of diagnostics) this.onError(Object.assign(new Error(diagnostic.message), diagnostic));
    } finally { this.restoring = false; }
  }

  async requestClose(id) {
    if (this.tabs?.metadata(id)) return this.tabs.close(id);
    const panel = this.layout.require(id);
    if (panel.onClose && await panel.onClose() === false) return false;
    if (!this.layout.panels.has(id)) return true;
    if (this.host.popouts.has(id)) this.host.returnPopout(id);
    this.layout.close(id);
    this.onClose(id);
    return true;
  }

  registerPanel({ id, title, kind = 'tool', element, onClose, activate = true, ...metadata }) {
    if (!element) throw new TypeError('A dynamic panel needs an element');
    this.layout.register({ id, title, kind, onClose, ...metadata });
    this.content.set(id, element);
    this.layout.open(id, null, { activate });
    return () => this.unregisterPanel(id);
  }

  unregisterPanel(id) {
    if (!this.layout.panels.has(id)) return;
    if (this.host.popouts.has(id)) this.host.returnPopout(id, { reopen: false, render: false });
    this.releasePanelContent(id);
    this.tabs?.forget(id);
    this.layout.unregister(id);
  }

  releasePanelContent(id) {
    (this.host.contents.get(id) ?? this.content.get(id))?.remove();
    this.host.contents.delete(id);
    this.content.delete(id);
  }

  registerToolKind(kind, factory, options) { return this.factories.register(kind, factory, options); }
  createTool(kind, instance, options) { return this.factories.create(kind, instance, options); }

  activate(id) {
    this.adapt();
    if (this.layout.locate(id).kind === 'closed' && ['msbuild', 'msbuild-inspector', 'project-source'].includes(id)) {
      const preferred = id === 'project-source' ? 'documents' : 'tools-bottom';
      const group = this.layout.group(preferred);
      if (group) this.layout.open(id, group.id);
    }
    if (this.layout.locate(id).kind === 'autoHide') this.host.showAutoPanel(id);
    else this.layout.open(id);
    this.onActivate(id);
  }

  title(id, title) {
    const panel = this.layout.panels.get(id);
    if (!panel || panel.title === title) return;
    panel.title = title;
    for (const tab of document.querySelectorAll(`[data-dock-tab="${this.host.escape(id)}"]`)) tab.textContent = title;
  }

  reset(preset = 'coding') {
    const documents = this.layout.groups().flatMap(group => group.panels).filter(id => this.layout.require(id).kind === 'document');
    const defaults = presetDockLayout(preset, documents);
    const registered = new Set(this.layout.panels.keys());
    const known = new Set(toolDefinitions.map(panel => panel.id));
    for (const id of registered) if (!known.has(id) && !documents.includes(id)) defaults.closed.push(id);
    this.layout.restore(defaults);
    if (preset === 'debug') { this.layout.dock('debug', 'tools-right'); this.layout.dock('watch', 'tools-right', 'bottom'); this.layout.open('stack'); }
    if (preset === 'winui') { this.layout.dock('winui', 'documents', 'right'); this.layout.open('winui'); this.layout.open('visual-tree'); }
    if (preset === 'decompile') { this.layout.dock('assembly', 'documents'); this.layout.open('assembly'); }
    this.mobile = false;
    this.adapt();
    return true;
  }

  adapt() {
    if (this.media.matches && !this.mobile) {
      this.mobile = true;
      this.mobileTools = [];
      for (const [id, side] of [['solution', 'left'], ['outline', 'left'], ['diagnostics', 'right'], ['project', 'right']]) {
        if (this.layout.locate(id).kind !== 'group') continue;
        this.mobileTools.push(id);
        this.layout.autoHide(id, side);
      }
    } else if (!this.media.matches && this.mobile) {
      this.mobile = false;
      for (const id of this.mobileTools ?? []) if (this.layout.locate(id).kind === 'autoHide') this.layout.pin(id);
      this.mobileTools = [];
    }
  }

  dispose() {
    this.media.removeEventListener('change', this.mediaListener);
    this.persistOff();
    this.tabs?.dispose();
    this.windows?.dispose();
    this.host.dispose();
  }
}
