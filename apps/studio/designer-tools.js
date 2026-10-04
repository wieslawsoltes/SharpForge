import {DesignDocument, DesignerSession, DesignerOptionsService, DesignerAssetPreviewStore} from '@sharpforge/designer';
import {ContextMenu} from '@sharpforge/controls';
import {WinUIHost} from '@sharpforge/winui';
import {DesignerSourceSync} from './designer-source-sync.js';
import {DesignerResourceSourceSync} from './designer-resource-sync.js';
import {DesignerChrome} from './designer-chrome.js';
import {DesignerSurfaceController} from './designer-surface-controller.js';
import {DesignerToolbox} from './designer-toolbox.js';
import {DesignerOutline} from './designer-outline.js';
import {DesignerAccessibility} from './designer-accessibility.js';
import {DesignerLiveAttachment} from './designer-live-attachment.js';
import {DesignerPropertyController} from './designer-property-view.js';
import {DesignerResourceController} from './designer-resource-view.js';
import {DesignerResourceGallery} from './designer-resource-gallery.js';
import {DesignerResourceContext, assertDesignerResourceAction, isDesignerResourceDocument} from './designer-resource-context.js';
import {DesignerOptionsController} from './designer-options-view.js';
import {DesignerAssetPreviewController} from './designer-property-preview.js';
import {mountDesignerSurface, resizeDesignerArtboard} from './designer-surface-view.js';
import {createDesignerActions, renderDesignerSource} from './designer-actions.js';
import {disposeDesignerTools} from './designer-tools-disposal.js';
import {DesignerDocumentUpdates} from './designer-document-updates.js';
import {buildDesignerPreviewScene} from './designer-preview-scene.js';

export const DESIGN_TOOLS = Object.freeze(['designer', 'designer-toolbox', 'designer-tree', 'designer-properties',
  'designer-layout', 'designer-styles', 'designer-source']);

/** Owns the visual tools for one session; shared Studio services are supplied explicitly. */
export class DesignerTools {
  constructor(services) {
    Object.assign(this, services);
    this.ownsSession = !services.session;
    this.session = services.session ?? new DesignerSession('View.sfdesign.json');
    this.initialized = false;
    this.disposed = false;
    this.syncing = false;
    this.search = '';
    this.propertySearch = '';
    this.styleKey = 'Accent';
    this.resourceKind = 'style';
    this.clipboardStore ??= {};
    this.menu = new ContextMenu({onError: error => this.error(error)});
    this.designerOptions ??= new DesignerOptionsService(services.settings);
    const SourceSync = this.session.kind === 'resources' ? DesignerResourceSourceSync : DesignerSourceSync;
    this.sourceSync = this.session.sourceSync ?? new SourceSync(this);
    this.session.sourceSync = this.sourceSync;
    this.sourceSync.auto = this.designerOptions.value.autoSync;
    this.naming = this.designerOptions.value.naming;
    this.chrome = new DesignerChrome(this);
    this.toolbox = new DesignerToolbox(this);
    this.outline = new DesignerOutline(this);
    this.accessibility = new DesignerAccessibility(this);
    this.surface = new DesignerSurfaceController(this);
    this.properties = new DesignerPropertyController(this);
    this.resources = new DesignerResourceController(this);
    this.resourceContext = new DesignerResourceContext(this);
    this.resourceGallery = new DesignerResourceGallery(this);
    this.options = new DesignerOptionsController(this);
    this.liveAttachment = new DesignerLiveAttachment(this);
    this.assetPreviews = new DesignerAssetPreviewStore({
      readAsset: path => this.readAsset(path),
      createObjectURL: blob => URL.createObjectURL(blob),
      revokeObjectURL: url => URL.revokeObjectURL(url),
      makeBlob: (bytes, type) => new Blob([bytes], {type})
    });
    this.assetPreviewController = new DesignerAssetPreviewController(this);
    this.updates = new DesignerDocumentUpdates(this);
    this.actions = createDesignerActions(this);
    this.subscribeDocument();
  }

  get document() { return this.templateScope?.document ?? this.session.document; }
  get resourceDocument() { return isDesignerResourceDocument(this); }
  get zoom() { return this.session.zoom; }
  set zoom(value) { this.session.zoom = value; }
  get mode() { return this.session.mode; }
  set mode(value) { this.session.mode = value; }
  get snap() { return this.session.snap; }
  set snap(value) { this.session.snap = value; }
  get preview() { return this.session.preview; }
  set preview(value) { this.session.preview = value; }
  get live() { return this.session.live; }
  set live(value) { this.session.live = value; }
  get status() { return this.session.status; }
  set status(value) { this.session.status = value; }
  get path() { return this.session.path; }
  set path(value) { this.session.path = value; }
  get controlsRoot() { return this.chrome.commandBar?.element ?? this.panel('designer'); }
  get clipboard() { return this.clipboardStore.document; }
  set clipboard(value) { this.clipboardStore.document = value; }
  get clipboardSelection() { return this.clipboardStore.selection; }
  set clipboardSelection(value) { this.clipboardStore.selection = value; }

  subscribeDocument() {
    this.modelSubscription?.();
    this.modelSubscription = this.document.subscribe(event => this.update(event));
  }

  panel(id) { return this.panelResolver?.(id) ?? this.docking.content.get(id); }

  error(error) {
    this.status = error.message ?? String(error);
    this.toast?.(this.status, 'error');
    if (this.statusElement) this.statusElement.textContent = this.status;
    this.accessibility?.reportError?.(error);
  }

  async safe(action) {
    try { return await action(); }
    catch (error) { this.error(error); return null; }
  }

  ensure() {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    mountDesignerSurface(this);
    this.host = new WinUIHost(this.previewRoot, {
      onEvent: () => {
        if (!this.preview) return;
        this.status = 'Preview input only · managed handlers run in the application';
        this.statusElement.textContent = this.status;
      },
      onLayout: () => { this.surface.geometry.invalidate(); this.drawAdorners(); },
      onMetrics: metrics => { this.metrics = metrics; },
      onError: error => this.error(error)
    });
    this.resizeObserver = new ResizeObserver(() => { this.surface.geometry.invalidate(); this.drawAdorners(); });
    this.resizeObserver.observe(this.stage);
    this.chrome.install();
    this.surface.install();
    this.accessibility.install();
    this.liveAttachment.install();
    this.sourceSync.install?.();
    this.update({kind: 'initialize'});
  }

  renderTool(id) {
    if (!DESIGN_TOOLS.includes(id)) return false;
    this.ensure();
    this.updates.renderTool(id);
    this.drawAdorners();
    return true;
  }

  replace(value, {live = null, path = 'View.sfdesign.json'} = {}) {
    const next = new DesignDocument(value);
    this.cancelSurfaceEdits();
    if (this.templateScope) this.resources.leaveTemplate(false);
    if (this.sourceSync.session && !this.sourceSync.loading) this.sourceSync.disconnect();
    const previous = this.session.document;
    this.session.document = next;
    this.subscribeDocument();
    previous.dispose();
    this.live = live;
    this.path = path;
    this.status = live ? 'Live application attached · changes are staged until Apply to live' : 'Design document opened';
    this.update({kind: 'load'});
  }

  enterTemplateScope(scope) {
    if (this.templateScope) throw new Error('A template is already being edited');
    this.cancelSurfaceEdits();
    this.templateScope = scope;
    this.subscribeDocument();
    this.update({kind: 'template-scope'});
  }

  leaveTemplateScope(scope) {
    if (this.templateScope !== scope) return;
    this.cancelSurfaceEdits();
    this.templateScope = null;
    this.subscribeDocument();
    this.update({kind: 'template-scope'});
    this.sourceSync.designChanged({kind: 'template edit'});
  }

  cancelSurfaceEdits() {
    this.surface.cancelPointer?.();
    this.surface.finishKeyboard(true);
    this.surface.text.cancel();
    this.resources?.playback.stop(false);
  }

  update(event = {}) {
    return this.updates.update(event);
  }

  updateTree(event) {
    return this.updates.updateTree(event);
  }

  flushVisiblePanels() { this.updates.flushVisible(); }

  buildPreviewScene() { return buildDesignerPreviewScene(this); }

  updatePreview(event) { return this.updates.preview.update(event); }

  updateButtons() {
    for (const [action, disabled] of [['undo', !this.canUndo()], ['redo', !this.canUndo(true)], ['apply', !this.live]]) {
      const button = this.controlsRoot.querySelector('[data-design-action="' + action + '"]');
      if (button) button.disabled = disabled;
    }
  }

  resizeArtboard() {
    if (!this.initialized || !this.stage || this.disposed) return;
    resizeDesignerArtboard(this);
    this.surface.preview.applyDimensions();
    this.surface.geometry.invalidate();
    this.drawAdorners();
    this.chrome.rulers();
  }

  renderToolbox() {
    this.toolbox.install();
    if (!this.resourceContext.renderPanel('designer-toolbox')) this.toolbox.render();
  }
  insert(type, point) { assertDesignerResourceAction(this, 'insert'); return this.toolbox.insert(type, point); }
  renderProperties() { if (!this.resourceContext.renderPanel('designer-properties')) this.properties.render(); }
  renderResources() { this.resources.render(); }
  renderLayout() { if (!this.resourceContext.renderPanel('designer-layout')) this.surface.layout.render(); }
  renderSource() { renderDesignerSource(this); }
  rect(id) { return this.surface.rect(id); }
  drawAdorners() { if (!this.resourceDocument) { this.surface.drawAdorners(); this.accessibility.adorners(); } }
  pointerDown(event) { if (!this.resourceDocument) return this.surface.pointerDown(event); }
  keydown(event) { if (!this.resourceDocument) return this.surface.keydown(event); }
  context(event) { if (!this.resourceDocument) return this.surface.context(event); }
  align(action) { assertDesignerResourceAction(this, action); return this.surface.align(action); }
  drawGridTracks() { return this.surface.drawGridTracks(); }
  trackPointer(...args) { return this.surface.trackPointer(...args); }
  reorder(delta) { assertDesignerResourceAction(this, 'reorder'); return this.surface.command(delta < 0 ? 'order:backward' : 'order:forward'); }
  attach(sessionId, options) { assertDesignerResourceAction(this, 'attach'); return this.liveAttachment.attach(sessionId, options); }
  applyLive(options) { assertDesignerResourceAction(this, 'apply'); return this.liveAttachment.apply(options); }
  componentDefinition(id) {
    const node = this.document.node(id);
    return node ? this.projectRoots?.definition(node) ?? null : null;
  }

  openComponent(id = this.document.selection[0]) {
    const definition = this.componentDefinition(id);
    if (!definition) throw new Error('The selected control has no project design document');
    return this.openDesignDocument(definition.uri);
  }

  canUndo(redo = false) {
    if (!this.templateScope && this.sourceSync.session && !this.sourceSync.dirty()) {
      return this.canUndoSource?.(this.session.uri, redo) ?? false;
    }
    return (redo ? this.document.redoStack : this.document.undoStack).length > 0;
  }

  undo(redo = false) {
    this.surface.finishKeyboard();
    if (!this.templateScope && this.sourceSync.session && !this.sourceSync.dirty()) {
      return this.undoSource?.(this.session.uri, redo) ?? false;
    }
    return this.document.undo(redo);
  }

  async readAsset(path) {
    const record = this.records().find(item => item.path === path);
    if (!record) throw new Error('Project image is no longer available');
    if (record.bytes) return record.bytes;
    if (typeof record.text === 'string') return new TextEncoder().encode(record.text);
    throw new Error('Project asset has no available bytes');
  }

  async save() {
    if (this.session.kind !== 'design' && this.sourceSync.session) return this.sourceSync.write();
    await this.saveDocument(this.path, this.session.document.serialize());
    this.session.document.savedRevision = this.session.document.revision;
    this.status = 'Saved ' + this.path;
    this.update({kind: 'saved'});
  }

  async action(action) {
    this.ensure();
    assertDesignerResourceAction(this, action);
    if (this.actions.has(action)) return this.actions.get(action)();
    return this.surface.command(action);
  }

  snapshot() {
    return {uri: this.session.uri, sourceSync: this.sourceSync.snapshot(), viewMode: this.chrome.mode,
      document: this.document.snapshot(), revision: this.document.revision, selection: [...this.document.selection],
      live: !!this.live, status: this.status, zoom: this.zoom, metrics: this.metrics};
  }

  dispose() { disposeDesignerTools(this); }
}
