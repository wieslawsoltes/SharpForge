import {DesignOrderSession, geometryInvariant} from '@sharpforge/designer';

/** DOM-only ordering feedback is discarded or committed when the held key gesture ends. */
export class DesignerOrderGesture {
  constructor(controller, ids) {
    this.controller = controller;
    this.document = controller.view.document;
    this.ids = ids.join('\0');
    this.kind = 'order';
    const view = controller.view;
    view.outline?.assertEditable();
    this.session = new DesignOrderSession(this.document, {ids,
      canEdit: id => !view.readOnly && !view.sourceSync?.session?.analysis?.readOnly && !(view.outline?.isLocked(id) ?? false)});
    this.elements = new Map(this.session.original.map(id => [id, view.host.elements.get(id)]));
    this.originalStyles = new Map([...this.elements].map(([id, element]) => [id, element?.style.zIndex]));
    this.parent = this.elements.values().next().value?.parentElement;
    geometryInvariant(this.parent && [...this.elements.values()].every(element => element?.parentElement === this.parent),
      'SFD_ORDER_LAYOUT', 'Rendered siblings must share one layout container before ordering.');
    this.canvas = this.document.node(this.session.parentId).type.endsWith('.Canvas');
  }

  update(delta) {
    this.session.update(delta > 0 ? 'forward' : 'backward');
    this.paint(this.session.next);
  }

  paint(order) {
    let cursor = this.parent.firstChild;
    order.forEach((id, index) => {
      const element = this.elements.get(id);
      if (element === cursor) cursor = cursor.nextSibling;
      else this.parent.insertBefore(element, cursor);
      if (this.canvas) element.style.zIndex = String(index);
    });
    this.controller.geometry.invalidate();
    this.controller.adorners.paint();
  }

  restore() {
    if (this.document !== this.controller.view.document || this.document.revision !== this.session.revision) return;
    this.paint(this.session.original);
    for (const [id, value] of this.originalStyles) this.elements.get(id).style.zIndex = value;
  }

  commit() { this.restore(); return this.session.commit(); }
  cancel() { this.restore(); return this.session.cancel(); }
}
