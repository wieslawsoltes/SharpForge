import {designerViewModes} from '../../packages/designer/src/index.js';
import {DesignerSplitView} from './designer-split-view.js';
import {disposeFailedDesigner} from './designer-document-errors.js';
import {captureDesignerEditorView, restoreDesignerEditorView} from './designer-editor-state.js';

export const designerSidePanelIds = Object.freeze([
  'designer-toolbox', 'designer-tree', 'designer-properties', 'designer-layout', 'designer-styles'
]);

function button(document, text, label, callback) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.title = label;
  element.setAttribute('aria-label', label);
  element.addEventListener('click', callback);
  return element;
}

/** A source document's permanent Design/Split/Code host. Its CodeEditor instance is never replaced by a mode change. */
export class DesignerDocumentView {
  constructor({session, element, editor, createTools, onActivate = () => {}, onHistory = () => false}) {
    this.session = session;
    this.element = element;
    this.editor = editor;
    this.disposed = false;
    this.panels = new Map();
    this.cleanup = [];
    const document = element.ownerDocument;
    this.codePane = document.createElement('div');
    this.codePane.append(...element.childNodes);
    this.surface = document.createElement('div');
    this.surface.className = 'panel-content designer-document-surface';
    this.surface.dataset.designerUri = session.uri;
    this.panels.set('designer', this.surface);
    for (const id of [...designerSidePanelIds, 'designer-source']) {
      const panel = document.createElement('div');
      panel.className = 'designer-document-side-panel';
      panel.dataset.designerPanel = id;
      panel.dataset.designerUri = session.uri;
      this.panels.set(id, panel);
    }
    this.buildBar(document);
    this.split = new DesignerSplitView({
      session, designPane: this.surface, codePane: this.codePane,
      onResize: () => this.resize(), beforeLayout: visible => this.captureEditorViewport(visible)
    });
    element.classList.add('designer-document');
    element.dataset.designerDocument = session.uri;
    element.replaceChildren(this.modeBar, this.split.element);
    this.listen(element, 'focusin', () => onActivate(session.uri));
    this.listen(element, 'pointerdown', () => onActivate(session.uri), {capture: true});
    this.listen(this.codePane, 'keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (onHistory(session.uri, key === 'y' || event.shiftKey) !== true) return;
      event.preventDefault();
      event.stopPropagation();
    }, {capture: true});
    this.unsubscribe = session.subscribe(event => {
      const viewportOnly = event.changed?.every(key => ['scrollLeft', 'scrollTop'].includes(key));
      if (['view', 'restore', 'replace'].includes(event.kind) && !viewportOnly) this.renderState();
      if (event.kind === 'restore') this.tools?.update({kind: 'initialize'});
    });
    try {
      this.tools = createTools(session, {documentHost: this, panelResolver: id => this.panels.get(id)});
      session.own('designer-tools', this.tools);
      this.tools.ensure();
      this.bindViewport();
      this.renderState();
    } catch (error) {
      throw disposeFailedDesigner(error, () => this.dispose());
    }
  }

  listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this.cleanup.push(() => target.removeEventListener(type, callback, options));
  }

  buildBar(document) {
    this.modeBar = document.createElement('div');
    this.modeBar.className = 'designer-document-view-bar';
    this.modeBar.setAttribute('role', 'toolbar');
    this.modeBar.setAttribute('aria-label', 'Designer document commands');
    this.modeControls = document.createElement('div');
    this.modeControls.className = 'designer-document-modes';
    this.modeControls.setAttribute('role', 'tablist');
    this.modeControls.setAttribute('aria-label', 'Document view');
    for (const mode of designerViewModes) {
      const control = button(document, mode[0].toUpperCase() + mode.slice(1), `View ${mode}`, () => this.setMode(mode));
      control.dataset.documentView = mode;
      control.setAttribute('role', 'tab');
      this.modeControls.append(control);
    }
    this.listen(this.modeControls, 'keydown', event => this.modeKeydown(event));
    this.layoutControls = document.createElement('div');
    this.layoutControls.className = 'designer-document-layout-controls';
    this.swapButton = button(document, 'Swap', 'Swap design and code panes', () => {
      this.session.setViewState({swapped: !this.session.viewState.swapped});
    });
    this.orientationButton = button(document, 'Stack', 'Change split orientation', () => {
      this.session.setViewState({orientation: this.session.viewState.orientation === 'vertical' ? 'horizontal' : 'vertical'});
    });
    this.collapseButton = button(document, 'Collapse code', 'Collapse or restore code pane', () => {
      const {collapsed, swapped} = this.session.viewState;
      this.session.setViewState({collapsed: collapsed ? null : swapped ? 'design' : 'code'});
    });
    this.layoutControls.append(this.swapButton, this.orientationButton, this.collapseButton);
    this.commandSlot = document.createElement('div');
    this.commandSlot.className = 'designer-document-command-slot';
    this.modeBar.append(this.modeControls, this.layoutControls, this.commandSlot);
  }

  modeKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = event.target.closest('[data-document-view]');
    if (!current) return;
    event.preventDefault();
    if (this.session.kind === 'design') return;
    const index = designerViewModes.indexOf(current.dataset.documentView);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    let next = (index + delta + designerViewModes.length) % designerViewModes.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = designerViewModes.length - 1;
    this.setMode(designerViewModes[next], {focus: false});
    this.modeControls.querySelector(`[data-document-view="${designerViewModes[next]}"]`).focus();
  }

  setMode(mode, {focus = true} = {}) {
    if (!designerViewModes.includes(mode)) throw new TypeError(`Unknown designer document mode: ${mode}`);
    if (this.session.kind === 'design' && mode !== 'design') {
      throw new Error('Standalone .sfdesign.json documents have a Design view; generated C# opens as a source document.');
    }
    this.session.setViewState({mode, collapsed: null});
    if (focus && mode === 'code') this.editor?.focus();
    else if (focus) this.tools.scroller?.focus({preventScroll: true});
    return mode;
  }

  bindViewport() {
    const scroller = this.tools.scroller;
    if (!scroller) return;
    this.listen(scroller, 'scroll', () => {
      if (!this.session.disposed) this.session.setViewState({scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop});
    }, {passive: true});
    scroller.scrollLeft = this.session.viewState.scrollLeft;
    scroller.scrollTop = this.session.viewState.scrollTop;
  }

  captureEditorViewport(willBeVisible) {
    if (!this.editor) return;
    if (!this.codePane.hidden && !willBeVisible) {
      this.editorViewport = captureDesignerEditorView(this.editor);
      this.editorViewportModel = this.editor.model;
    }
    if (this.codePane.hidden && willBeVisible) this.pendingEditorViewport = this.editorViewport;
  }

  restoreEditorViewport() {
    const saved = this.pendingEditorViewport;
    if (!saved || !this.editor || this.codePane.hidden) return;
    this.pendingEditorViewport = null;
    if (this.editor.model !== this.editorViewportModel) return;
    const selections = saved.version === this.editor.model.version ? saved : {
      ...saved, selections: this.editor.getSelections(), primaryIndex: this.editor.primaryIndex
    };
    restoreDesignerEditorView(this.editor, selections);
  }

  renderState() {
    const {mode, orientation, collapsed, swapped} = this.session.viewState;
    this.element.dataset.designerMode = mode;
    for (const control of this.modeControls.querySelectorAll('[data-document-view]')) {
      const active = control.dataset.documentView === mode;
      control.setAttribute('aria-selected', String(active));
      control.tabIndex = active ? 0 : -1;
      control.disabled = this.session.kind === 'design' && control.dataset.documentView !== 'design';
    }
    this.layoutControls.hidden = mode !== 'split';
    this.orientationButton.textContent = orientation === 'vertical' ? 'Stack' : 'Side by side';
    this.collapseButton.textContent = collapsed ? 'Restore split' : swapped ? 'Collapse design' : 'Collapse code';
    this.resize();
  }

  resize() {
    if (!this.tools?.initialized || this.disposed) return;
    this.tools.resizeArtboard();
    this.tools.drawAdorners();
    this.editor?.paint();
    this.restoreEditorViewport();
  }

  /** Restores the ordinary source root if compatibility disappears; the editor remains alive. */
  dispose({restoreSource = true} = {}) {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    const attempt = action => { try { action(); } catch (error) { errors.push(error); } };
    attempt(() => this.unsubscribe?.());
    this.unsubscribe = null;
    attempt(() => this.split?.dispose());
    for (const cleanup of this.cleanup.splice(0)) attempt(cleanup);
    for (const panel of this.panels.values()) attempt(() => panel.remove());
    if (restoreSource) attempt(() => this.element.replaceChildren(...this.codePane.childNodes));
    attempt(() => this.element.classList.remove('designer-document'));
    attempt(() => { delete this.element.dataset.designerDocument; });
    attempt(() => { delete this.element.dataset.designerMode; });
    if (errors.length) throw new AggregateError(errors, `Could not dispose every designer view resource for ${this.session.uri}`);
  }
}
