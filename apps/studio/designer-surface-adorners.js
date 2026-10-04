import {designAnchors, inverseMatrix, multiplyMatrix, rectanglesIntersect, translationMatrix} from '@sharpforge/designer';

const handles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

function style(element, values) {
  for (const [name, value] of Object.entries(values)) if (element.style[name] !== value) element.style[name] = value;
}

/** Visible selection only; a fixed DOM budget prevents a large multi-selection from flooding the overlay. */
export class DesignerAdornerLayer {
  constructor(view, geometry, {maxAdorners = 200} = {}) {
    this.view = view;
    this.geometry = geometry;
    this.maxAdorners = maxAdorners;
    this.boxes = new Map();
    this.frame = null;
    this.frameWindow = null;
    this.guideGroup = null;
    this.guideLines = [];
  }

  request() {
    if (this.frame !== null) return;
    const window = this.view.stage.ownerDocument.defaultView;
    this.frameWindow = window;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.frameWindow = null;
      this.view.safe(() => this.paint());
      this.view.safe(() => this.view.surface?.drawGridTracks());
    });
  }

  create(id) {
    const document = this.view.overlay.ownerDocument;
    const box = document.createElement('div');
    box.className = 'design-selection';
    box.dataset.selectionId = id;
    box.style.transformOrigin = '0 0';
    box.style.left = '0';
    box.style.top = '0';
    const label = document.createElement('span');
    label.className = 'design-measure';
    box.append(label);
    for (const handle of handles) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'design-handle';
      button.dataset.resize = handle;
      button.dataset.controlId = id;
      button.setAttribute('aria-label', `Resize ${handle}`);
      box.append(button);
    }
    this.view.overlay.append(box);
    this.boxes.set(id, box);
    return box;
  }

  paint(rectangles = null) {
    const view = this.view;
    if (!view.initialized || !view.stage?.isConnected) return;
    if (view.preview) {
      this.clear();
      return;
    }
    this.geometry.refresh();
    const selected = new Set(view.document.selection);
    const visible = this.visibleSelection(selected);
    const retained = new Set();
    for (const {id} of visible) {
      const entry = this.geometry.entries.get(id);
      if (!entry) continue;
      retained.add(id);
      const rectangle = rectangles?.[id] ?? entry.rectangle;
      const box = this.boxes.get(id) ?? this.create(id);
      let matrix = entry.stageMatrix;
      if (rectangles?.[id]) {
        const parent = multiplyMatrix(this.geometry.stageInverse, entry.parentMatrix);
        const oldPlacement = translationMatrix(entry.rectangle.Left, entry.rectangle.Top);
        const relative = multiplyMatrix(inverseMatrix(multiplyMatrix(parent, oldPlacement)), entry.stageMatrix);
        matrix = multiplyMatrix(multiplyMatrix(parent, translationMatrix(rectangle.Left, rectangle.Top)), relative);
      }
      style(box, {transform: `matrix(${matrix.join(', ')})`, width: `${rectangle.Width}px`, height: `${rectangle.Height}px`});
      box.classList.toggle('primary', id === view.document.selection[0]);
      const label = `${entry.node.properties.Name || id} · ${rectangle.Width.toFixed(1)} × ${rectangle.Height.toFixed(1)}`;
      if (box.firstChild.textContent !== label) box.firstChild.textContent = label;
      const locked = view.outline?.isLocked(id) ?? false;
      for (const button of box.querySelectorAll('[data-resize]')) button.hidden = locked || id === view.document.value.root;
      this.anchors(box, entry, locked);
    }
    for (const [id, box] of this.boxes) {
      if (retained.has(id)) continue;
      box.remove();
      this.boxes.delete(id);
    }
    if (view.overlay.dataset.visibleSelection !== String(visible.length)) view.overlay.dataset.visibleSelection = String(visible.length);
    if (view.overlay.dataset.selectionCount !== String(selected.size)) view.overlay.dataset.selectionCount = String(selected.size);
  }

  visibleSelection(selected) {
    const bounds = this.geometry.visibleBounds();
    const visible = item => this.view.outline?.isVisible(item.id) ?? true;
    if (selected.size <= this.maxAdorners && this.geometry.index.items) {
      const items = [];
      for (const id of selected) {
        const item = this.geometry.index.items.get(id);
        if (item && rectanglesIntersect(bounds, item.bounds) && visible(item)) items.push(item);
      }
      return items;
    }
    return this.geometry.index.search(bounds, {limit: this.maxAdorners, predicate: item => selected.has(item.id) && visible(item)});
  }

  anchors(box, entry, locked) {
    const parent = this.view.document.parent(entry.id);
    const applicable = this.view.mode === 'layout' && parent && !parent.type.endsWith('.Canvas') && !locked;
    let rail = box.querySelector('[data-anchor-rail]');
    if (!applicable) {
      rail?.remove();
      return;
    }
    if (!rail) {
      rail = box.ownerDocument.createElement('div');
      rail.dataset.anchorRail = '';
      Object.assign(rail.style, {position: 'absolute', top: '-30px', left: '0', display: 'flex', pointerEvents: 'auto'});
      for (const side of ['left', 'top', 'right', 'bottom']) {
        const button = box.ownerDocument.createElement('button');
        button.dataset.anchorSide = side;
        button.dataset.controlId = entry.id;
        button.setAttribute('aria-label', `Toggle ${side} margin anchor`);
        button.setAttribute('aria-description', 'Click to toggle; drag to adjust the margin. Alt temporarily disables snapping.');
        button.addEventListener('click', event => {
          if (event.detail === 0) this.view.safe(() => this.view.surface.anchor(entry.id, side));
        });
        button.textContent = side[0].toUpperCase();
        rail.append(button);
      }
      box.append(rail);
    }
    const anchors = designAnchors(entry.node.properties);
    for (const button of rail.children) button.setAttribute('aria-pressed', String(anchors[button.dataset.anchorSide]));
  }

  guides(guides, parentId) {
    if (!guides.length) {
      if (this.guideGroup) this.guideGroup.hidden = true;
      return;
    }
    const parent = this.geometry.get(parentId);
    if (!parent) {
      if (this.guideGroup) this.guideGroup.hidden = true;
      return;
    }
    if (this.guideGroup?.parentElement !== this.view.overlay) {
      this.guideGroup?.remove();
      this.guideGroup = this.view.overlay.ownerDocument.createElement('div');
      this.guideGroup.dataset.smartGuides = '';
      this.guideLines = [];
      this.view.overlay.append(this.guideGroup);
    }
    const group = this.guideGroup;
    group.hidden = false;
    style(group, {position: 'absolute', inset: '0px', transformOrigin: '0px 0px',
      transform: `matrix(${parent.stageMatrix.join(', ')})`});
    for (const [index, guide] of guides.entries()) {
      let line = this.guideLines[index];
      if (!line) {
        line = group.ownerDocument.createElement('div');
        line.className = 'design-grid-line';
        this.guideLines.push(line);
        group.append(line);
      }
      if (line.dataset.guideKind !== guide.kind) line.dataset.guideKind = guide.kind;
      const title = guide.kind === 'spacing' ? `Equal spacing: ${guide.gap}px` : guide.kind;
      if (line.title !== title) line.title = title;
      style(line, {left: guide.axis === 'x' ? `${guide.position}px` : '0px', top: guide.axis === 'y' ? `${guide.position}px` : '0px',
        width: guide.axis === 'y' ? `${parent.width}px` : '', height: guide.axis === 'x' ? `${parent.height}px` : '',
        borderLeft: guide.axis === 'x' ? '1px solid rgb(230, 122, 200)' : '',
        borderTop: guide.axis === 'y' ? '1px solid rgb(230, 122, 200)' : ''});
    }
    while (this.guideLines.length > guides.length) this.guideLines.pop().remove();
  }

  clear() {
    for (const box of this.boxes.values()) box.remove();
    this.boxes.clear();
    this.guideGroup?.remove();
    this.guideGroup = null;
    this.guideLines = [];
  }

  dispose() {
    if (this.frame !== null) this.frameWindow.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.frameWindow = null;
    this.clear();
  }
}
