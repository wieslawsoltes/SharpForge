/** Bookmarks are logical line anchors; edit and history events move the same anchors. */
export class BookmarkModel {
  constructor(model) { this.model = model; this.lines = new Set(); this.past = []; this.future = []; }
  has(line) { return this.lines.has(line); }
  toggle(line) { if (this.lines.has(line)) this.lines.delete(line); else this.lines.add(line); }
  clear() { this.lines.clear(); }
  next(line, direction = 1) {
    const lines = [...this.lines].sort((left, right) => left - right);
    if (!lines.length) return null;
    return direction > 0 ? lines.find(value => value > line) ?? lines[0] : lines.findLast(value => value < line) ?? lines.at(-1);
  }
  applyChange(event) {
    const source = event.source ?? event.command;
    if (source === 'undo' && this.past.length) {
      this.future.push([...this.lines]);
      this.lines = new Set(this.past.pop());
      return;
    }
    if (source === 'redo' && this.future.length) {
      this.past.push([...this.lines]);
      this.lines = new Set(this.future.pop());
      return;
    }
    this.past.push([...this.lines]);
    if (this.past.length > 1000) this.past.shift();
    this.future.length = 0;
    for (const change of [...event.changes].sort((left, right) => right.start - left.start)) {
      const first = change.range?.start.line ?? event.before.positionAt(change.start).line;
      const last = change.range?.end.line ?? event.before.positionAt(change.end).line;
      const inserted = (change.text.match(/\r\n|\n|\r/g) ?? []).length;
      const delta = inserted - (last - first);
      this.lines = new Set([...this.lines].map(line => line > last ? line + delta : line >= first ? Math.min(line, first + inserted) : line));
    }
  }
}
