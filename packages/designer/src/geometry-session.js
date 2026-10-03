import {normalizeProperty} from './model.js';
import {designRectangle, geometryInvariant, localPointerDelta, resizeRectangle} from './geometry-coordinates.js';

/** Gesture previews never touch DesignDocument. Commit performs exactly one optimistic edit. */
export class DesignGeometrySession {
  constructor(document, {rectangles, matrices = {}, baselines = {}, start = {x: 0, y: 0}, handle = null, constraints = {}, label} = {}) {
    geometryInvariant(rectangles && Object.keys(rectangles).length > 0, 'SFD_GESTURE_EMPTY', 'Select a control before editing.');
    this.document = document;
    this.revision = document.revision;
    this.original = Object.fromEntries(Object.entries(rectangles).map(([id, rectangle]) => [id, designRectangle(rectangle)]));
    this.next = structuredClone(this.original);
    this.matrices = matrices;
    this.baselines = {...baselines};
    this.constraints = constraints;
    this.start = start;
    this.handle = handle;
    this.label = label ?? (handle ? 'Resize controls' : 'Move controls');
    this.active = true;
    this.guides = [];
  }

  update(pointer, {snaplines = null, disabled = false} = {}) {
    geometryInvariant(this.active, 'SFD_GESTURE_ENDED', 'The editing gesture has ended.');
    const entries = Object.entries(this.original);
    const primaryId = entries[0][0];
    this.guides = [];
    let snapDelta = {x: 0, y: 0};
    for (const [id, rectangle] of entries) {
      const delta = localPointerDelta(this.matrices[id] ?? [1, 0, 0, 1, 0, 0], this.start, pointer);
      let next = this.handle ? resizeRectangle(rectangle, this.handle, delta, this.constraints[id])
        : {...rectangle, Left: rectangle.Left + delta.x, Top: rectangle.Top + delta.y};
      if (id === primaryId && snaplines) {
        const result = snaplines.snap(next, {disabled, handle: this.handle, baseline: this.baselines[id]});
        next = result.bounds;
        snapDelta = result.delta;
        this.guides = result.guides;
      } else if (!this.handle) {
        next.Left += snapDelta.x;
        next.Top += snapDelta.y;
      }
      this.next[id] = next;
    }
    return this.next;
  }

  nudge(delta, {resize = false} = {}) {
    geometryInvariant(this.active, 'SFD_GESTURE_ENDED', 'The editing gesture has ended.');
    for (const [id, rectangle] of Object.entries(this.next)) {
      this.next[id] = resize ? resizeRectangle(rectangle, 'se', delta, this.constraints[id])
        : {...rectangle, Left: rectangle.Left + delta.x, Top: rectangle.Top + delta.y};
    }
    return this.next;
  }

  commit({properties = null} = {}) {
    geometryInvariant(this.active, 'SFD_GESTURE_ENDED', 'The editing gesture has ended.');
    this.active = false;
    return this.document.change(this.label, candidate => {
      const nodes = new Map(candidate.nodes.map(node => [node.id, node]));
      for (const [id, rectangle] of Object.entries(this.next)) {
        const node = nodes.get(id);
        geometryInvariant(node, 'SFD_GESTURE_NODE', 'An edited control no longer exists.');
        for (const [key, value] of Object.entries(rectangle)) {
          if (properties && !properties(id).includes(key)) continue;
          if (value === this.original[id][key]) continue;
          node.properties[key] = normalizeProperty(node.type, key, value);
        }
      }
    }, {expectedRevision: this.revision});
  }

  cancel() {
    this.active = false;
    this.next = structuredClone(this.original);
    this.guides = [];
    return this.next;
  }

  dispose() {
    if (this.active) this.cancel();
  }
}
