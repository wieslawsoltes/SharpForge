import {DesignGeometrySession, geometryInvariant, boundsOfPoints, toggleDesignAnchor,
  guideSettings, DesignSnaplines} from '@sharpforge/designer';
import {DesignerOrderGesture} from './designer-surface-order.js';
import {marginLayoutBounds} from './designer-surface-margin.js';
import {localSnapBaseline, localSnapTarget} from './designer-surface-snap-targets.js';

/** Pointer/keyboard gesture ownership is explicit; no temporary document or history mutation is needed. */
export class DesignerSurfaceGestures {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.keyboard = null;
    this.active = null;
  }

  ids() {
    return this.view.document.selection.filter(id => id !== this.view.document.value.root
      && !(this.view.outline?.isLocked(id) ?? false) && (this.view.outline?.isVisible(id) ?? true));
  }

  baseline(entry, origin, matrix) { return localSnapBaseline(entry, origin, matrix); }

  session(ids, {start = {x: 0, y: 0}, handle = null} = {}) {
    const entries = ids.map(id => this.controller.geometry.get(id));
    geometryInvariant(entries.every(Boolean), 'SFD_GESTURE_LAYOUT', 'All edited controls must have rendered layout.');
    const rectangles = Object.fromEntries(entries.map(entry => [entry.id, entry.rectangle]));
    const matrices = Object.fromEntries(entries.map(entry => [entry.id, handle ? entry.matrix : entry.parentMatrix]));
    const baselines = Object.fromEntries(entries.map(entry => [entry.id, this.baseline(entry, entry.rectangle.Top)]));
    const constraints = Object.fromEntries(entries.map(entry => [entry.id, {minWidth: entry.node.properties.MinWidth ?? 0,
      minHeight: entry.node.properties.MinHeight ?? 0, maxWidth: entry.node.properties.MaxWidth ?? Infinity,
      maxHeight: entry.node.properties.MaxHeight ?? Infinity}]));
    const canEdit = (id, property) => !this.view.outline?.isLocked(id)
      && !this.view.sourceSync?.session?.analysis?.bindings?.[id]?.properties?.[property]?.dynamic;
    return new DesignGeometrySession(this.view.document, {rectangles, matrices, constraints, baselines, start, handle, canEdit});
  }

  properties(id) {
    return this.view.document.parent(id)?.type.endsWith('.Canvas') ? ['Left', 'Top', 'Width', 'Height'] : ['Width', 'Height'];
  }

  snaplines(parentId, excluded) {
    const settings = guideSettings(this.view.document.value);
    const parent = this.controller.geometry.get(parentId);
    geometryInvariant(parent, 'SFD_SNAP_PARENT', 'Snap parent has no rendered layout.');
    const excludedIds = new Set(excluded);
    const siblings = [];
    if (settings.snapSiblings) {
      for (const id of parent.node.children) {
        if (excludedIds.has(id) || !(this.view.outline?.isVisible(id) ?? true)) continue;
        const entry = this.controller.geometry.entries?.get(id) ?? this.controller.geometry.get(id);
        if (entry) siblings.push(entry.snap ?? localSnapTarget(entry));
      }
    }
    const guides = settings.snapGuides ? settings.guides.map(guide => {
      const axisAligned = Math.abs(parent.stageMatrix[1]) < 1e-9 && Math.abs(parent.stageMatrix[2]) < 1e-9;
      if (!axisAligned) return null;
      const offset = guide.axis === 'x' ? parent.stageMatrix[4] : parent.stageMatrix[5];
      const scale = guide.axis === 'x' ? parent.stageMatrix[0] : parent.stageMatrix[3];
      return {...guide, position: (guide.position - offset) / scale};
    }).filter(Boolean) : [];
    return new DesignSnaplines({siblings, guides, parent: {Width: parent.width, Height: parent.height},
      tolerance: settings.tolerance, gridSize: settings.gridSize, snapGrid: settings.snapGrid});
  }

  pointerDown(event) {
    const view = this.view;
    if (view.preview || event.button !== 0 || this.controller.zoom.space || event.target.closest('[data-inline-text]')) return;
    this.finishKeyboard();
    const anchor = event.target.closest('[data-anchor-side]');
    if (anchor) {
      event.preventDefault();
      event.stopPropagation();
      this.controller.margin.begin(event, anchor.dataset.controlId, anchor.dataset.anchorSide);
      return;
    }
    if (event.target.closest('[data-user-guide],[data-grid-rails]')) return;
    if (this.controller.drawing.start(event)) return;
    const handle = event.target.closest('[data-resize]');
    const hit = event.target.closest('[data-sf-id]')?.dataset.sfId;
    const id = handle?.dataset.controlId ?? view.host.nodes.get(hit)?.designId ?? hit;
    if (!id || !view.document.node(id) || !(view.outline?.isVisible(id) ?? true)) return;
    event.preventDefault();
    event.stopPropagation();
    view.scroller.focus({preventScroll: true});
    if (event.shiftKey && view.document.node(id).children.length) return this.marquee(event, id);
    if (event.ctrlKey || event.metaKey) {
      const selected = view.document.selection.includes(id) ? view.document.selection.filter(item => item !== id)
        : [...view.document.selection, id];
      view.document.select(selected);
      return;
    }
    if (!view.document.selection.includes(id)) view.document.select(id);
    if (view.outline?.isLocked(id) || id === view.document.value.root) return;
    const ids = handle ? [id] : this.ids();
    const parentId = view.document.parent(id)?.id;
    const sameParent = ids.every(item => view.document.parent(item)?.id === parentId);
    if (!handle && ids.some(item => !view.document.parent(item)?.type.endsWith('.Canvas'))) {
      return this.layoutDrag(event, ids, parentId);
    }
    const session = this.session(ids, {start: {x: event.clientX, y: event.clientY}, handle: handle?.dataset.resize});
    this.active = session;
    const snaplines = sameParent ? this.snaplines(parentId, ids) : null;
    this.controller.trackPointer(event, pointer => {
      session.update({x: pointer.clientX, y: pointer.clientY}, {snaplines, disabled: pointer.altKey});
      this.controller.adorners.paint(session.next);
      this.controller.adorners.guides(session.guides, parentId);
    }, () => {
      this.active = null;
      try { session.commit({properties: item => this.properties(item)}); }
      finally {
        this.controller.adorners.guides([], null);
        this.controller.drawAdorners();
      }
    }, () => {
      session.cancel();
      this.active = null;
      this.controller.adorners.guides([], null);
      this.controller.drawAdorners();
    });
  }

  layoutDrag(event, ids, parentId) {
    const parent = this.view.document.node(parentId);
    const revision = this.view.document.revision;
    geometryInvariant(ids.every(id => this.view.document.parent(id)?.id === parentId),
      'SFD_LAYOUT_PARENT', 'Reordering layout children requires a common parent.');
    let target = null;
    this.controller.trackPointer(event, pointer => {
      const point = this.controller.geometry.localPoint(parentId, {x: pointer.clientX, y: pointer.clientY});
      if (parent.type.endsWith('.Grid')) {
        const entry = this.controller.geometry.get(parentId);
        const cell = (coordinate, values, gap) => {
          const sizes = values.split(' ').map(Number.parseFloat).filter(Number.isFinite);
          let sum = 0;
          for (let index = 0; index < sizes.length; index++) {
            sum += sizes[index] + gap;
            if (coordinate < sum) return index;
          }
          return Math.max(0, sizes.length - 1);
        };
        target = {Row: cell(point.y, entry.style.gridTemplateRows, Number.parseFloat(entry.style.rowGap) || 0),
          Column: cell(point.x, entry.style.gridTemplateColumns, Number.parseFloat(entry.style.columnGap) || 0)};
      } else {
        target = this.controller.drawing.insertion(parent, point);
        geometryInvariant(target, 'SFD_LAYOUT_DROP', 'This parent does not expose an insertion layout.');
        this.controller.drawing.show(parent, {...target.indicator, Width: Math.max(2, target.indicator.Width),
          Height: Math.max(2, target.indicator.Height)});
      }
    }, () => {
      this.controller.drawing.clear();
      if (!target) return;
      this.view.document.change('Move layout selection', candidate => {
        const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
        const owner = nodes.get(parentId);
        if (Object.hasOwn(target, 'Row')) {
          for (const id of ids) Object.assign(nodes.get(id).properties, target);
        } else {
          const chosen = new Set(ids);
          const moving = owner.children.filter(id => chosen.has(id));
          const prior = owner.children.slice(0, target.index).filter(id => chosen.has(id)).length;
          owner.children = owner.children.filter(id => !chosen.has(id));
          owner.children.splice(target.index - prior, 0, ...moving);
        }
      }, {expectedRevision: revision});
    }, () => this.controller.drawing.clear());
  }

  marquee(event, parentId) {
    const start = this.controller.geometry.stagePoint({x: event.clientX, y: event.clientY});
    const current = this.view.document.selection;
    const parent = this.view.document.node(parentId);
    const children = new Set(parent.children);
    let rectangle = null;
    this.controller.trackPointer(event, pointer => {
      const point = this.controller.geometry.stagePoint({x: pointer.clientX, y: pointer.clientY});
      rectangle = boundsOfPoints([start, point]);
      this.controller.drawing.show(null, rectangle);
    }, () => {
      this.controller.drawing.clear();
      if (!rectangle) return;
      const hits = this.controller.geometry.index.search(rectangle, {predicate: item => children.has(item.id)
        && (this.view.outline?.isVisible(item.id) ?? true) && !(this.view.outline?.isLocked(item.id) ?? false)}).map(item => item.id);
      this.view.document.select(event.ctrlKey || event.metaKey ? [...new Set([...current, ...hits])] : hits.length ? hits : [parentId]);
    }, () => this.controller.drawing.clear());
  }

  anchor(id, side) {
    const entry = this.controller.geometry.get(id);
    const parent = this.controller.geometry.get(this.view.document.parent(id)?.id);
    geometryInvariant(entry && parent, 'SFD_ANCHOR_MEASUREMENT', 'Margin anchors require measured child and parent layout.');
    return toggleDesignAnchor(this.view.document, {id, side, ...marginLayoutBounds(entry, parent)});
  }

  nudge(event) {
    const ids = this.ids();
    const resize = event.ctrlKey || event.metaKey;
    geometryInvariant(ids.length && (resize || ids.every(id => this.view.document.parent(id)?.type.endsWith('.Canvas'))),
      'SFD_NUDGE_PARENT', 'Movement requires Canvas children; Ctrl+arrow resizes layout children.');
    if (!this.keyboard || this.keyboard.kind !== 'geometry' || this.keyboard.resize !== resize ||
      this.keyboard.document !== this.view.document || this.keyboard.ids !== ids.join('\0')) {
      this.finishKeyboard();
      this.keyboard = {kind: 'geometry', ids: ids.join('\0'), session: this.session(ids), resize, document: this.view.document};
    }
    const amount = event.shiftKey ? guideSettings(this.view.document.value).gridSize : 1;
    const delta = {x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
      y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0};
    this.keyboard.session.nudge(delta, {resize});
    this.controller.adorners.paint(this.keyboard.session.next);
  }

  orderKey(event, delta) {
    const ids = this.view.document.selection;
    if (this.keyboard?.kind !== 'order' || this.keyboard.document !== this.view.document || this.keyboard.ids !== ids.join('\0')) {
      this.finishKeyboard();
      this.keyboard = new DesignerOrderGesture(this.controller, ids);
    }
    this.keyboard.update(delta);
  }

  finishKeyboard(cancel = false) {
    const keyboard = this.keyboard;
    this.keyboard = null;
    if (!keyboard) return;
    try {
      if (keyboard.kind === 'order') {
        if (cancel) keyboard.cancel();
        else keyboard.commit();
      } else if (cancel) keyboard.session.cancel();
      else keyboard.session.commit({properties: id => this.properties(id)});
    } finally { this.controller.drawAdorners(); }
  }

  dispose() {
    this.active?.dispose();
    this.active = null;
    this.finishKeyboard(true);
  }
}
