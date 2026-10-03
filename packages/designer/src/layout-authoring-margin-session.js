import {resolvedProperties} from './model.js';
import {geometryInvariant, localPointerDelta} from './geometry-coordinates.js';
import {setDesignMargin} from './layout-authoring-anchors.js';

const sides = {left: ['Left', 'x', 1], top: ['Top', 'y', 1], right: ['Right', 'x', -1], bottom: ['Bottom', 'y', -1]};

/** Margin dragging uses parent layout coordinates and publishes one existing setDesignMargin operation on release. */
export class DesignMarginSession {
  constructor(document, {id = document.selection[0], side, matrix, start, canEdit = () => true} = {}) {
    document.assertActive();
    const node = document.node(id);
    const parent = document.parent(id);
    geometryInvariant(node && parent && !parent.type.endsWith('.Canvas'), 'SFD_ANCHOR_PARENT', 'Margin dragging requires a layout parent.');
    geometryInvariant(Object.hasOwn(sides, side), 'SFD_ANCHOR_SIDE', 'Unknown margin anchor.');
    geometryInvariant(!document.readOnly && canEdit(id) !== false && canEdit(parent.id) !== false,
      'SFD_ANCHOR_READ_ONLY', 'Unlock the control and its layout parent before editing margins.');
    geometryInvariant(!node.bindings?.Margin && !node.resourceReferences?.Margin && !node.templatePropertyBindings?.Margin,
      'SFD_ANCHOR_EXPRESSION', 'A binding or resource controls this margin. Edit the expression in Properties.');
    const effective = resolvedProperties(document.value, node).properties.Margin ?? {};
    this.original = Object.fromEntries(Object.values(sides).map(([name]) => [name, effective[name] ?? 0]));
    this.document = document;
    this.revision = document.revision;
    this.id = id;
    this.side = side;
    this.matrix = matrix;
    this.start = start;
    this.next = {...this.original};
    this.active = true;
  }

  update(pointer, {gridSize = 1, disabled = false} = {}) {
    geometryInvariant(this.active, 'SFD_ANCHOR_ENDED', 'The margin gesture has ended.');
    geometryInvariant(Number.isFinite(gridSize) && gridSize > 0, 'SFD_ANCHOR_GRID', 'Margin snapping requires a positive grid size.');
    const [name, axis, sign] = sides[this.side];
    const delta = localPointerDelta(this.matrix, this.start, pointer);
    const value = this.original[name] + sign * delta[axis];
    this.next[name] = disabled ? value : Math.round(value / gridSize) * gridSize;
    return this.next;
  }

  commit() {
    geometryInvariant(this.active, 'SFD_ANCHOR_ENDED', 'The margin gesture has ended.');
    this.active = false;
    const [name] = sides[this.side];
    if (this.next[name] === this.original[name]) return false;
    return setDesignMargin(this.document, {id: this.id, side: this.side, value: this.next[name], expectedRevision: this.revision});
  }

  cancel() {
    this.active = false;
    this.next = {...this.original};
    return this.next;
  }

  dispose() { if (this.active) this.cancel(); }
}
