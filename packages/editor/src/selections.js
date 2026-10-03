/** Normalize ordered UTF-16 selections, preserving the primary selection's direction when ranges overlap. */
export function normalizeSelections(selections, length = Number.MAX_SAFE_INTEGER, primaryIndex = 0) {
  if (!Array.isArray(selections) || !selections.length) throw new RangeError('At least one selection is required');
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid document length');
  if (!Number.isInteger(primaryIndex) || primaryIndex < 0 || primaryIndex >= selections.length) throw new RangeError('Invalid primary selection');
  const ordered = selections.map((selection, index) => {
    const anchor = selection.anchor ?? selection.start;
    const active = selection.active ?? selection.head ?? selection.end ?? anchor;
    if (!Number.isSafeInteger(anchor) || !Number.isSafeInteger(active)) throw new RangeError('Selection offsets must be integers');
    const result = {
      ...selection, anchor: Math.max(0, Math.min(length, anchor)), active: Math.max(0, Math.min(length, active)),
      primary: index === primaryIndex, order: selection.order ?? index
    };
    result.head = result.active;
    result.start = Math.min(result.anchor, result.active);
    result.end = Math.max(result.anchor, result.active);
    return result;
  }).sort((first, second) => first.start - second.start || first.end - second.end || first.order - second.order);
  const merged = [];
  for (const selection of ordered) {
    const previous = merged.at(-1);
    if (!previous || selection.start > previous.end) { merged.push(selection); continue; }
    const direction = selection.primary ? selection : previous;
    const start = Math.min(previous.start, selection.start);
    const end = Math.max(previous.end, selection.end);
    const backward = direction.anchor > direction.active;
    merged[merged.length - 1] = {
      ...direction, start, end, anchor: backward ? end : start, active: backward ? start : end, head: backward ? start : end,
      primary: previous.primary || selection.primary, order: Math.max(previous.order, selection.order)
    };
  }
  const primary = merged.findIndex(selection => selection.primary);
  return Object.freeze({
    selections: Object.freeze(merged.map(({ primary: _, order, ...selection }) => Object.freeze({ ...selection, order }))),
    primaryIndex: primary < 0 ? 0 : primary
  });
}

/** Transform an offset through non-overlapping edits in original-document coordinates. */
export function transformOffset(offset, edits, affinity = 'right') {
  let delta = 0;
  for (const edit of edits) {
    const end = edit.end ?? edit.start + edit.deleteCount;
    const inserted = edit.text.length;
    if (offset < edit.start || offset === edit.start && affinity === 'left') break;
    if (offset < end) return edit.start + delta + (affinity === 'right' ? inserted : 0);
    delta += inserted - (end - edit.start);
  }
  return offset + delta;
}

/** Selections remain ordered and bounded after edits, with explicit edge affinity for anchors and carets. */
export function transformSelections(selections, edits, length, primaryIndex = 0) {
  const transformed = selections.map(selection => {
    const collapsed = selection.anchor === selection.active;
    const backward = selection.anchor > selection.active;
    return {
      ...selection,
      anchor: transformOffset(selection.anchor, edits, collapsed || backward ? 'right' : 'left'),
      active: transformOffset(selection.active, edits, collapsed || !backward ? 'right' : 'left')
    };
  });
  return normalizeSelections(transformed, length, primaryIndex);
}

/** Explicit selection state for one view; multiple views can share a buffer with independent instances. */
export class SelectionSet {
  #state;
  constructor(selections = [{ anchor: 0, active: 0 }], { length = Number.MAX_SAFE_INTEGER, primaryIndex = 0 } = {}) {
    this.#state = normalizeSelections(selections, length, primaryIndex);
  }
  get selections() { return this.#state.selections; }
  get primaryIndex() { return this.#state.primaryIndex; }
  get primary() { return this.selections[this.primaryIndex]; }
  set(selections, length, primaryIndex = 0) { this.#state = normalizeSelections(selections, length, primaryIndex); return this; }
  transform(edits, length) { this.#state = transformSelections(this.selections, edits, length, this.primaryIndex); return this; }
  collapse() { return this.set([{ anchor: this.primary.active, active: this.primary.active }], Number.MAX_SAFE_INTEGER); }
  snapshot() { return this.#state; }
}
