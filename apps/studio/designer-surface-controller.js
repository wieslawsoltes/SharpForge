import {arrangeDesignSelection, designScene, guideSettings, multiplyMatrix, updateGuideSettings} from '@sharpforge/designer';
import {DesignerSurfaceGeometry} from './designer-surface-geometry.js';
import {DesignerAdornerLayer} from './designer-surface-adorners.js';
import {DesignerSurfaceZoom} from './designer-surface-zoom.js';
import {DesignerLayoutPreview} from './designer-layout-preview.js';
import {DesignerLayoutPanel} from './designer-layout-panel.js';
import {DesignerInlineText} from './designer-surface-text.js';
import {DesignerDrawCreate} from './designer-surface-drawing.js';
import {DesignerUserGuides} from './designer-surface-guides.js';
import {DesignerSurfaceCommands} from './designer-surface-commands.js';
import {DesignerSurfaceGestures} from './designer-surface-gestures.js';
import {DesignerMarginDrag} from './designer-surface-margin.js';
import {activateDesignerEvent, defaultDesignerEvent} from './designer-event-actions.js';
import {disposeDesignerPointer, prepareDesignerPointer, trackDesignerPointer} from './designer-surface-pointer.js';

/** Explicit integration seam for visual surface authoring; legacy DesignerTools delegates here. */
export class DesignerSurfaceController {
  constructor(view) {
    this.view = view;
    this.geometry = new DesignerSurfaceGeometry(view);
    this.adorners = new DesignerAdornerLayer(view, this.geometry);
    this.zoom = new DesignerSurfaceZoom(this);
    this.preview = new DesignerLayoutPreview(this);
    this.layout = new DesignerLayoutPanel(this);
    this.text = new DesignerInlineText(this);
    this.drawing = new DesignerDrawCreate(this);
    this.guides = new DesignerUserGuides(this);
    this.gestures = new DesignerSurfaceGestures(this);
    this.margin = new DesignerMarginDrag(this);
    this.commands = new DesignerSurfaceCommands(this);
    this.listeners = [];
    this.cancelPointer = null;
    this.pointerLayer = null;
    this.installed = false;
    this.disposed = false;
    this.lastDocument = view.document;
    this.multiply = multiplyMatrix;
    this.lastClick = null;
    this.doubleClickInterval = null;
  }

  install() {
    if (this.installed || this.disposed) return;
    this.installed = true;
    const view = this.view;
    prepareDesignerPointer(this);
    const listen = (element, type, handler, options) => {
      element.addEventListener(type, handler, options);
      this.listeners.push(() => element.removeEventListener(type, handler, options));
    };
    listen(view.stage, 'pointerdown', event => view.safe(() => this.pointerDown(event)), true);
    listen(view.stage, 'contextmenu', event => {
      if (view.preview) return;
      event.preventDefault();
      event.stopPropagation();
      this.context(event);
    });
    listen(view.scroller, 'keydown', event => this.keydown(event));
    listen(view.scroller, 'keyup', event => {
      if (event.key.startsWith('Arrow') || event.key === 'Alt' && this.gestures.keyboard?.kind === 'order') {
        view.safe(() => this.finishKeyboard());
      }
    });
    listen(view.scroller, 'focusout', event => {
      if (!view.scroller.contains(event.relatedTarget)) view.safe(() => this.finishKeyboard());
    });
    listen(view.stage, 'dblclick', event => this.doubleClick(event));
    listen(view.stage, 'click', event => this.click(event));
    listen(view.stage.ownerDocument.defaultView, 'blur', () => {
      this.cancelPointer?.();
      view.safe(() => this.finishKeyboard());
    });
    this.zoom.install();
    this.preview.install();
    this.drawing.install();
    this.guides.install();
    const snap = (view.controlsRoot ?? view.panel('designer')).querySelector('#designer-snap');
    if (snap) {
      snap.min = '.25';
      snap.max = '1024';
      snap.step = 'any';
      snap.onchange = () => view.safe(() => updateGuideSettings(view.document, {gridSize: Number(snap.value)}));
    }
    this.onDocumentChanged({kind: 'initialize'});
  }

  scene(document = this.view.document.value, options) {
    return this.installed ? this.preview.scene(document, options) : designScene(document);
  }

  onDocumentChanged(event = {}) {
    if (!this.installed || this.disposed) return;
    const documentChanged = this.lastDocument !== this.view.document;
    if (documentChanged) {
      this.cancelPointer?.();
      this.gestures.finishKeyboard(true);
      this.text.cancel();
      this.lastDocument = this.view.document;
      this.lastClick = null;
      this.preview.environment.update({state: null});
    }
    if (documentChanged || event.kind !== 'selection') this.geometry.invalidate();
    if (documentChanged || event.kind !== 'selection' && event.changes?.kind !== 'properties') {
      this.preview.applyDimensions();
      this.guides.render();
      const snap = (this.view.controlsRoot ?? this.view.panel('designer')).querySelector('#designer-snap');
      if (snap) snap.value = String(guideSettings(this.view.document.value).gridSize);
    }
    this.drawAdorners();
  }

  rect(id) {
    return this.geometry.rect(id);
  }

  drawAdorners() {
    if (!this.installed || this.disposed || this.gestures.active || this.gestures.keyboard || this.margin.active) return;
    this.adorners.request();
  }

  drawGridTracks() {
    this.layout.drawRails();
  }

  pointerDown(event) {
    return this.gestures.pointerDown(event);
  }

  click(event) {
    if (this.view.preview) return;
    const hit = event.target.closest('[data-sf-id]')?.dataset.sfId;
    const id = this.view.host.nodes.get(hit)?.designId ?? hit;
    if (!id || !this.view.document.node(id)) return;
    const previous = this.lastClick;
    this.lastClick = {id, time: event.timeStamp, x: event.clientX, y: event.clientY};
    const interval = previous?.id === id ? event.timeStamp - previous.time : null;
    this.doubleClickInterval = {id, interval};
    const samePoint = previous && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 4;
    if (event.detail === 1 && interval >= 450 && interval <= 1500 && samePoint && !this.view.componentDefinition?.(id)) {
      this.lastClick = null;
      this.view.safe(() => this.text.begin(id));
    }
  }

  doubleClick(event) {
    const view = this.view;
    if (view.preview) return;
    const hit = event.target.closest('[data-sf-id]')?.dataset.sfId;
    const id = view.host.nodes.get(hit)?.designId ?? hit;
    if (!id || !view.document.node(id)) return;
    event.preventDefault();
    event.stopPropagation();
    if (view.componentDefinition?.(id)) {
      this.lastClick = null;
      view.safe(() => view.openComponent(id));
      return;
    }
    const slow = this.doubleClickInterval?.id === id && this.doubleClickInterval.interval >= 400;
    const eventName = slow ? null : defaultDesignerEvent(view, id);
    this.lastClick = null;
    if (eventName) return view.safe(() => activateDesignerEvent(view, id, eventName));
    return view.safe(() => this.text.begin(id));
  }

  snaplines(parentId, excluded) {
    return this.gestures.snaplines(parentId, excluded);
  }

  align(action) {
    const rectangles = Object.fromEntries(this.view.document.selection.map(id => [id, this.rect(id)]));
    return arrangeDesignSelection(this.view.document, rectangles, action);
  }

  anchor(id, side) {
    return this.gestures.anchor(id, side);
  }

  finishKeyboard(cancel = false) {
    return this.gestures.finishKeyboard(cancel);
  }

  orderKey(event, delta) {
    return this.gestures.orderKey(event, delta);
  }

  command(id) {
    return this.commands.run(id);
  }

  context(event) {
    return this.commands.context(event);
  }

  setPreview(patch) {
    this.cancelPointer?.();
    this.finishKeyboard();
    this.text.cancel();
    return this.preview.set(patch);
  }

  fitAll() {
    this.zoom.fit({Left: 0, Top: 0, Width: this.preview.value.width ?? this.view.document.value.width,
      Height: this.preview.value.height ?? this.view.document.value.height});
  }

  fitSelection() {
    this.zoom.fit(this.geometry.selectionBounds());
  }

  keydown(event) {
    if (event.key === 'Escape' && (this.cancelPointer || this.gestures.keyboard)) {
      this.cancelPointer?.();
      this.finishKeyboard(true);
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (this.view.accessibility?.handleKey(event)) return true;
    if (this.view.preview || event.target.matches('input,select,textarea,[contenteditable=true]')) return false;
    if (event.key === 'Escape') {
      this.cancelPointer?.();
      this.finishKeyboard(true);
      this.text.cancel();
      this.drawing.clear();
      this.drawing.choose(null);
      event.preventDefault();
      return true;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.view.safe(() => this.gestures.nudge(event));
      return true;
    }
    const modified = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const bindings = {c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', y: 'redo', z: event.shiftKey ? 'redo' : 'undo'};
    const command = event.key === 'F2' ? 'inline-text' : event.key === 'Delete' ? 'delete' : modified ? bindings[key] : null;
    if (command) {
      event.preventDefault();
      event.stopPropagation();
      this.view.safe(() => this.command(command));
      return true;
    }
    if (modified && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      this.finishKeyboard();
      this.view.safe(() => this.view.action('save'));
      return true;
    }
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const rectangle = this.view.stage.getBoundingClientRect();
      this.context({clientX: rectangle.left + 20, clientY: rectangle.top + 20, target: this.view.scroller});
      return true;
    }
    return false;
  }

  /** Captures one pointer, coalesces move events to animation frames, and removes every listener on termination. */
  trackPointer(start, move, done, cancel = () => {}) {
    return trackDesignerPointer(this, start, move, done, cancel);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    disposeDesignerPointer(this);
    for (const dispose of this.listeners.splice(0)) dispose();
    for (const owned of [this.gestures, this.margin, this.text, this.drawing, this.guides,
      this.zoom, this.preview, this.adorners, this.geometry]) owned.dispose();
  }
}
