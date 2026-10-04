/** Per-editor clipboard history. OS clipboard content enters only through an explicit copy/cut/paste. */
export class ClipboardRing {
  constructor(limit = 15) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid clipboard ring size');
    this.limit = limit;
    this.entries = [];
    this.index = -1;
    this.lastRange = null;
  }
  push(text) {
    if (typeof text !== 'string' || !text) return;
    this.entries = [text, ...this.entries.filter(entry => entry !== text)].slice(0, this.limit);
    this.index = -1;
    this.lastRange = null;
  }
  cycle(editor) {
    if (!this.entries.length || editor.input.readOnly) return false;
    const old = this.lastRange;
    const replace = old && editor.model.version === old.version && editor.offset === old.end;
    const start = replace ? old.start : editor.input.selectionStart;
    const end = replace ? old.end : editor.input.selectionEnd;
    this.index = (this.index + 1) % this.entries.length;
    const text = this.entries[this.index];
    editor.insert(text, start, end);
    this.lastRange = {start, end: start + text.length, version: editor.model.version};
    editor.accessibility.announce(`Clipboard item ${this.index + 1} of ${this.entries.length}`);
    return true;
  }
}

/** Prepare a same-document drag as one transaction. Drop inside the selection is a no-op. */
export function dragTextEdits(model, start, end, target, copy = false) {
  if (![start, end, target].every(Number.isInteger) || start < 0 || end < start || end > model.length || target < 0 || target > model.length) {
    throw new RangeError('Invalid drag text range');
  }
  if (target >= start && target <= end) return {edits: [], selections: [{anchor: start, active: end}]};
  const text = model.getText(start, end);
  const edits = copy ? [{start: target, end: target, text}] : [{start, end, text: ''}, {start: target, end: target, text}];
  const next = !copy && target > end ? target - (end - start) : target;
  return {edits, selections: [{anchor: next, active: next + text.length}]};
}
