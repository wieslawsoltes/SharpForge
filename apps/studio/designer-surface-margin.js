import {DesignMarginSession, geometryInvariant, guideSettings} from '@sharpforge/designer';

/** A click toggles an anchor; a drag edits that margin with reversible real-layout feedback. */
export class DesignerMarginDrag {
  constructor(controller) {
    this.controller = controller;
    this.active = null;
  }

  begin(event, id, side) {
    const controller = this.controller;
    const view = controller.view;
    controller.finishKeyboard();
    controller.cancelPointer?.();
    const entry = controller.geometry.get(id);
    geometryInvariant(entry, 'SFD_ANCHOR_MEASUREMENT', 'The margin control must have rendered bounds.');
    const bindings = view.sourceSync?.session?.analysis?.bindings ?? {};
    const session = new DesignMarginSession(view.document, {id, side, matrix: entry.parentMatrix,
      start: {x: event.clientX, y: event.clientY}, canEdit: target => !view.readOnly && !view.sourceSync?.session?.analysis?.readOnly &&
        !(view.outline?.isLocked(target) ?? false) && !bindings[target]?.properties?.Margin?.dynamic});
    const state = {session, element: entry.element, margin: entry.element.style.margin, dragged: false,
      start: {x: event.clientX, y: event.clientY}};
    this.active = state;
    controller.trackPointer(event, pointer => this.move(state, pointer), () => this.finish(state), () => this.cancel(state));
  }

  move(state, pointer) {
    state.dragged ||= Math.hypot(pointer.clientX - state.start.x, pointer.clientY - state.start.y) >= 3;
    if (!state.dragged) return;
    const margins = state.session.update({x: pointer.clientX, y: pointer.clientY}, {
      gridSize: guideSettings(state.session.document.value).gridSize, disabled: pointer.altKey
    });
    state.element.style.margin = `${margins.Top}px ${margins.Right}px ${margins.Bottom}px ${margins.Left}px`;
    this.controller.geometry.remeasure([state.session.id]);
    this.controller.adorners.paint();
  }

  restore(state) {
    if (state.session.document !== this.controller.view.document || state.session.revision !== state.session.document.revision) return;
    state.element.style.margin = state.margin;
    this.controller.geometry.remeasure([state.session.id]);
  }

  finish(state) {
    this.active = null;
    this.restore(state);
    try {
      if (state.dragged) state.session.commit();
      else {
        state.session.cancel();
        this.controller.anchor(state.session.id, state.session.side);
      }
    } finally {
      this.controller.drawAdorners();
    }
  }

  cancel(state = this.active) {
    if (!state) return;
    this.active = null;
    this.restore(state);
    state.session.cancel();
    this.controller.drawAdorners();
  }

  dispose() { this.cancel(); }
}
