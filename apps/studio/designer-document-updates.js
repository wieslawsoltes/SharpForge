import {DesignerOutlineProjection} from './designer-outline-projection.js';
import {DesignerPreviewProjection} from './designer-preview-projection.js';

const selectionPanels = ['designer-properties', 'designer-layout', 'designer-styles'];
const panelMethods = new Map([
  ['designer-toolbox', 'renderToolbox'], ['designer-properties', 'renderProperties'], ['designer-layout', 'renderLayout'],
  ['designer-styles', 'renderResources'], ['designer-source', 'renderSource']
]);

/** Docking uses hidden ancestors and detached owner roots; checking those does not force browser layout. */
export function designerPanelVisible(view, id) {
  const panel = view.panel(id);
  return !!panel && panel.isConnected !== false && !panel.closest?.('[hidden]');
}

/** Keep derived model structure and hidden panel work out of the synchronous selection path. */
export class DesignerDocumentUpdates {
  constructor(view) {
    this.view = view;
    this.tree = new DesignerOutlineProjection(view);
    this.preview = new DesignerPreviewProjection(view);
    this.pending = new Set();
    this.document = null;
    this.revision = -1;
    this.disposed = false;
    this.unsubscribe = view.docking?.layout?.subscribe(() => this.flushVisible());
  }

  update(event = {}) {
    const view = this.view;
    if (!view.initialized || view.disposed || this.disposed) return;
    const selection = event.kind === 'selection' && this.document === view.document && this.revision === view.document.revision;
    const properties = event.changes?.kind === 'properties' && this.document === view.document && this.revision + 1 === view.document.revision;
    const contextChanged = !selection && !properties;
    view.syncing = true;
    try {
      if (contextChanged) view.resourceContext.update();
      view.surface.onDocumentChanged(event);
      this.updateTree(event);
      if (!selection) view.updatePreview(event);
      for (const id of selectionPanels) this.pending.add(id);
      if (contextChanged) this.pending.add('designer-toolbox');
      this.flushVisible();
      view.updateButtons();
      const status = view.status + ' · revision ' + view.document.revision;
      if (view.statusElement.textContent !== status) view.statusElement.textContent = status;
      if (!view.resourceDocument) {
        if (contextChanged) view.outline.projectVisibility();
        view.accessibility.update(event);
        view.liveAttachment.update(event);
      }
      view.chrome.renderSelection(view.resourceContext.breadcrumbContext());
      if (!selection) {
        if (contextChanged) view.chrome.rulers();
        if (!view.templateScope) view.sourceSync.designChanged(event);
        if (contextChanged || event.changes.nodes.some(node => node.properties.includes('Source'))) {
          view.safe(() => view.assetPreviewController.refresh());
        }
      }
      this.document = view.document;
      this.revision = view.document.revision;
    } finally { view.syncing = false; }
  }

  updateTree(event = {}) {
    this.tree.update(event);
    this.pending.add('designer-tree');
  }

  /** Called after docking or document routing, so a newly visible panel cannot expose a stale selection. */
  flushVisible() {
    if (this.disposed || this.view.disposed || !this.view.initialized) return;
    for (const id of [...this.pending]) if (designerPanelVisible(this.view, id)) this.renderTool(id);
  }

  renderTool(id) {
    if (this.disposed || this.view.disposed) return false;
    if (id === 'designer-tree') {
      this.view.treeView.render();
      if (!this.view.resourceDocument) this.view.outline.render({project: false});
    } else {
      const method = panelMethods.get(id);
      if (!method) return false;
      this.view[method]();
    }
    this.pending.delete(id);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.preview.dispose();
    this.pending.clear();
    this.document = null;
  }
}
