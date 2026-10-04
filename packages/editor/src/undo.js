function sameSelections(first, second) {
  return first.length === second.length && first.every((selection, index) =>
    selection.anchor === second[index].anchor && selection.active === second[index].active);
}

function copyEdits(edits) {
  return Object.freeze(edits.map(({ start, end, text }) => Object.freeze({ start, end, text })));
}

function copySelections(selections) { return Object.freeze(selections.map(selection => Object.freeze({ ...selection }))); }

/** Operation-only undo history. Storage depends on edit payloads and the configured operation limit, never file size. */
export class UndoStack {
  #history = [];
  #future = [];
  #sequence = 0;
  #state = 0;
  #saved = 0;
  #barrier = false;
  #group = null;
  #groupDepth = 0;
  constructor({ maxOperations = 1000, coalesceMs = 750, clock = () => performance.now() } = {}) {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new RangeError('Invalid undo operation limit');
    if (!Number.isFinite(coalesceMs) || coalesceMs < 0) throw new RangeError('Invalid undo coalescing interval');
    this.maxOperations = maxOperations;
    this.coalesceMs = coalesceMs;
    this.clock = clock;
  }
  get canUndo() { return this.#history.length > 0; }
  get canRedo() { return this.#future.length > 0; }
  get stateId() { return this.#state; }
  get isDirty() { return this.#state !== this.#saved; }
  get depth() { return this.#history.length; }
  get redoDepth() { return this.#future.length; }
  get statistics() {
    let operations = 0;
    let characters = 0;
    for (const group of [...this.#history, ...this.#future]) {
      operations += group.count;
      characters += group.characters;
    }
    return { groups: this.depth + this.redoDepth, operations, retainedCharacters: characters };
  }
  markSaved() { this.#saved = this.#state; this.pushUndoStop(); }
  pushUndoStop() { this.#barrier = true; }
  beginUndoGroup(command = 'transaction') {
    if (this.#groupDepth++ === 0) { this.#group = { command }; this.pushUndoStop(); }
  }
  endUndoGroup() {
    if (this.#groupDepth === 0) throw new Error('No undo group is open');
    if (--this.#groupDepth === 0) { this.#group = null; this.pushUndoStop(); }
  }
  /** Record committed edits. Adjacent typing/deletion coalesces only with matching selection continuity and command. */
  record(event, { beforeSelections, afterSelections, beforePrimaryIndex = 0, afterPrimaryIndex = 0,
    command = 'edit', time = this.clock(), undoStop = false } = {}) {
    if (!event.changes.length) return;
    const previous = this.#history.at(-1);
    const step = Object.freeze({ edits: copyEdits(event.changes), inverseEdits: copyEdits(event.inverseEdits) });
    const sameGroup = this.#group && previous?.explicitGroup === this.#group;
    const canCoalesce = previous && (sameGroup || !this.#group && !this.#barrier && !undoStop
      && previous.afterState !== this.#saved && sameSelections(previous.afterSelections, beforeSelections)
      && ['typing', 'insertText', 'deleteBackward', 'deleteForward'].includes(command)
      && previous.command === command && time >= previous.time && time - previous.time <= this.coalesceMs);
    const characters = step.edits.reduce((sum, edit) => sum + edit.text.length, 0)
      + step.inverseEdits.reduce((sum, edit) => sum + edit.text.length, 0);
    const afterState = ++this.#sequence;
    const group = Object.freeze({
      command, time, explicitGroup: this.#group,
      head: Object.freeze({ step, previous: canCoalesce ? previous.head : null }),
      count: (canCoalesce ? previous.count : 0) + 1,
      characters: (canCoalesce ? previous.characters : 0) + characters,
      beforeSelections: canCoalesce ? previous.beforeSelections : copySelections(beforeSelections),
      afterSelections: copySelections(afterSelections),
      beforePrimaryIndex: canCoalesce ? previous.beforePrimaryIndex : beforePrimaryIndex, afterPrimaryIndex,
      beforeState: canCoalesce ? previous.beforeState : this.#state, afterState
    });
    if (canCoalesce) this.#history[this.#history.length - 1] = group;
    else this.#history.push(group);
    if (this.#history.length > this.maxOperations) this.#history.shift();
    this.#future.length = 0;
    this.#state = afterState;
    this.#barrier = undoStop;
  }
  /** Apply inverse edits newest first, returning the exact pre-command multi-selection snapshot. */
  undo(buffer) {
    const group = this.#history.at(-1);
    if (!group) return null;
    for (let node = group.head; node; node = node.previous) buffer.applyEdits(node.step.inverseEdits, { source: 'undo' });
    this.#history.pop();
    this.#future.push(group);
    this.#state = group.beforeState;
    this.restoredPrimaryIndex = group.beforePrimaryIndex;
    this.pushUndoStop();
    return group.beforeSelections;
  }
  redo(buffer) {
    const group = this.#future.at(-1);
    if (!group) return null;
    const steps = [];
    for (let node = group.head; node; node = node.previous) steps.push(node.step);
    for (let index = steps.length - 1; index >= 0; index--) buffer.applyEdits(steps[index].edits, { source: 'redo' });
    this.#future.pop();
    this.#history.push(group);
    this.#state = group.afterState;
    this.restoredPrimaryIndex = group.afterPrimaryIndex;
    this.pushUndoStop();
    return group.afterSelections;
  }
  checkpoint() {
    return { history: this.#history.slice(), future: this.#future.slice(), state: this.#state, saved: this.#saved, barrier: this.#barrier };
  }
  restoreCheckpoint(checkpoint) {
    this.#history = checkpoint.history.slice();
    this.#future = checkpoint.future.slice();
    this.#state = checkpoint.state;
    this.#saved = checkpoint.saved;
    this.#barrier = checkpoint.barrier;
  }
  clear({ saved = true } = {}) {
    this.#history.length = 0;
    this.#future.length = 0;
    this.#state = ++this.#sequence;
    if (saved) this.#saved = this.#state;
    this.pushUndoStop();
  }
}
