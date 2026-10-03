import {childSlot, createDrawnControl, designRectangle, geometryInvariant, layoutInsertion} from '@sharpforge/designer';

/** Toolbox ghosts and draw-to-create share the same insertion and one-commit creation path. */
export class DesignerDrawCreate {
  constructor(controller) {
    this.controller = controller;
    this.view = controller.view;
    this.type = null;
    this.dragType = null;
    this.ghost = null;
    this.dropSnap = null;
    this.listeners = [];
  }

  choose(type) {
    this.type = type;
    if (this.view.stage) this.view.stage.style.cursor = type ? 'crosshair' : '';
    this.view.status = type ? `Draw ${type.split('.').at(-1)}; Escape cancels` : 'Selection tool';
    if (this.view.statusElement) this.view.statusElement.textContent = this.view.status;
  }

  parent(target = null) {
    const hit = target?.closest('[data-sf-id]')?.dataset.sfId;
    let node = this.view.document.node(this.view.host.nodes.get(hit)?.designId ?? hit ?? this.view.document.selection[0]);
    while (node) {
      const slot = childSlot(node.type);
      if (slot && (slot.many || !node.children.length) && !(this.view.outline?.isLocked(node.id) ?? false)) return node;
      node = this.view.document.parent(node.id);
    }
    if (this.view.toolbox?.insertionParent) return this.view.toolbox.insertionParent();
    throw new Error('Select an unlocked container with an available child slot.');
  }

  create(type, options) {
    if (this.view.toolbox?.createDrawn) {
      const bounds = options.bounds;
      return this.view.toolbox.createDrawn(type, {...options, index: options.index ?? undefined,
        bounds: {x: bounds.Left, y: bounds.Top, width: bounds.Width, height: bounds.Height}});
    }
    return createDrawnControl(this.view.document, {type, ...options});
  }

  show(parent, bounds) {
    const entry = parent ? this.controller.geometry.get(parent.id) : {stageMatrix: [1, 0, 0, 1, 0, 0]};
    if (!this.ghost) {
      this.ghost = this.view.overlay.ownerDocument.createElement('div');
      this.ghost.className = 'design-marquee';
      this.ghost.dataset.drawPreview = '';
      this.view.overlay.append(this.ghost);
    }
    Object.assign(this.ghost.style, {left: '0', top: '0', transformOrigin: '0 0',
      transform: `matrix(${entry.stageMatrix.join(',')}) translate(${bounds.Left}px, ${bounds.Top}px)`,
      width: `${bounds.Width}px`, height: `${bounds.Height}px`, borderStyle: 'dashed'});
  }

  insertion(parent, point) {
    const entry = this.controller.geometry.get(parent.id);
    const type = parent.type.split('.').at(-1);
    const horizontal = parent.properties.Orientation === 1;
    const children = parent.children.map(id => this.controller.geometry.get(id)).filter(Boolean);
    if (!['StackPanel', 'WrapGrid', 'ItemsWrapGrid', 'VariableSizedWrapGrid', 'ItemsControl'].includes(type)) return null;
    return layoutInsertion({children: children.map(child => child.rectangle), point,
      orientation: horizontal ? 'horizontal' : 'vertical', wrap: type.includes('Wrap'),
      bounds: {Width: entry.width, Height: entry.height}});
  }

  start(event) {
    if (!this.type) return false;
    event.preventDefault();
    event.stopPropagation();
    const type = this.type;
    const parent = this.parent(event.target);
    const start = this.controller.geometry.localPoint(parent.id, {x: event.clientX, y: event.clientY});
    const revision = this.view.document.revision;
    let bounds = null;
    const snaplines = this.controller.snaplines(parent.id, []);
    this.controller.trackPointer(event, pointer => {
      const point = this.controller.geometry.localPoint(parent.id, {x: pointer.clientX, y: pointer.clientY});
      bounds = designRectangle({Left: Math.min(start.x, point.x), Top: Math.min(start.y, point.y),
        Width: Math.abs(point.x - start.x), Height: Math.abs(point.y - start.y)});
      if (bounds.Width > 0 && bounds.Height > 0) {
        const handle = `${point.y >= start.y ? 's' : 'n'}${point.x >= start.x ? 'e' : 'w'}`;
        const result = snaplines.snap(bounds, {disabled: pointer.altKey, handle});
        bounds = result.bounds;
        this.controller.adorners.guides(result.guides, parent.id);
      }
      this.show(parent, bounds);
    }, () => {
      this.clear();
      this.choose(null);
      geometryInvariant(revision === this.view.document.revision, 'SFD_CREATE_STALE', 'The document changed while drawing.');
      if (bounds?.Width > 0 && bounds?.Height > 0) this.create(type, {parentId: parent.id, bounds});
    }, () => { this.clear(); this.choose(null); });
    return true;
  }

  install() {
    const listen = (element, event, handler, options) => {
      element.addEventListener(event, handler, options);
      this.listeners.push(() => element.removeEventListener(event, handler, options));
    };
    const toolbox = this.view.panel('designer-toolbox');
    listen(toolbox, 'click', event => {
      const button = event.target.closest('[data-control]');
      if (!button || event.detail > 1 || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      this.choose(button.dataset.control);
    }, true);
    listen(toolbox, 'dragstart', event => {
      const button = event.target.closest('[data-control]');
      if (!button) return;
      this.dragType = button.dataset.control;
      event.dataTransfer.setData('application/x-sharpforge-control', this.dragType);
      event.dataTransfer.effectAllowed = 'copy';
    });
    listen(this.view.stage, 'dragover', event => {
      if (!event.dataTransfer.types.includes('application/x-sharpforge-control')) return;
      event.preventDefault();
      const parent = this.parent(event.target);
      const point = this.controller.geometry.localPoint(parent.id, {x: event.clientX, y: event.clientY});
      const insertion = this.insertion(parent, point);
      if (insertion) this.show(parent, {...insertion.indicator, Width: Math.max(2, insertion.indicator.Width),
        Height: Math.max(2, insertion.indicator.Height)});
      else {
        if (this.dropSnap?.parentId !== parent.id || this.dropSnap?.revision !== this.view.document.revision) {
          this.dropSnap = {parentId: parent.id, revision: this.view.document.revision,
            engine: this.controller.snaplines(parent.id, [])};
        }
        const result = this.dropSnap.engine.snap({Left: point.x, Top: point.y, Width: 120, Height: 36},
          {disabled: event.altKey});
        this.show(parent, result.bounds);
        this.controller.adorners.guides(result.guides, parent.id);
      }
    });
    listen(this.view.stage, 'drop', event => {
      const type = event.dataTransfer.getData('application/x-sharpforge-control');
      if (!type) return;
      event.preventDefault();
      event.stopPropagation();
      this.view.safe(() => {
        const parent = this.parent(event.target);
        const point = this.controller.geometry.localPoint(parent.id, {x: event.clientX, y: event.clientY});
        const insertion = this.insertion(parent, point);
        const result = this.controller.snaplines(parent.id, []).snap({Left: point.x, Top: point.y, Width: 120, Height: 36},
          {disabled: event.altKey});
        this.clear();
        this.create(type, {parentId: parent.id, bounds: result.bounds, index: insertion?.index ?? null});
      });
    });
    listen(this.view.stage.ownerDocument, 'dragend', () => this.clear());
    listen(this.view.stage.ownerDocument, 'keydown', event => {
      if (event.key !== 'Escape' || !this.type && !this.ghost) return;
      event.preventDefault();
      this.clear();
      this.choose(null);
    });
  }

  clear() {
    this.ghost?.remove();
    this.ghost = null;
    this.dragType = null;
    this.dropSnap = null;
    this.controller.adorners.guides([], null);
  }

  dispose() {
    for (const dispose of this.listeners.splice(0)) dispose();
    this.clear();
    this.choose(null);
  }
}
