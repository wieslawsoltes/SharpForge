/** Compare touched lines to open/save snapshots. Snapshots share buffer storage rather than copying source. */
export class ChangeTracking {
  constructor(model) { this.model = model; this.opened = model.snapshot(); this.saved = this.opened; this.touched = new Set(); }

  applyChange(event) {
    for (const change of [...event.changes].sort((left, right) => right.start - left.start)) {
      const start = change.range?.start.line ?? event.before.positionAt(change.start).line;
      const oldEnd = change.range?.end.line ?? event.before.positionAt(change.end).line;
      const inserted = (change.text.match(/\r\n|\n|\r/g) ?? []).length;
      const delta = inserted - (oldEnd - start);
      this.touched = new Set([...this.touched].map(line => line > oldEnd ? line + delta : line));
      for (let line = start; line <= start + inserted; line++) this.touched.add(line);
    }
  }

  stateAt(line) {
    if (!this.touched.has(line) || line >= this.model.lineCount) return null;
    const current = this.model.getLine(line);
    const saved = snapshotLine(this.saved, line);
    if (current !== saved) return 'unsaved';
    return current !== snapshotLine(this.opened, line) ? 'saved' : null;
  }

  markSaved() { this.saved = this.model.snapshot(); }

  hunk(line) {
    if (!this.stateAt(line)) return null;
    let first = line;
    let last = line;
    while (first > 0 && this.stateAt(first - 1) === this.stateAt(line)) first--;
    while (last + 1 < this.model.lineCount && this.stateAt(last + 1) === this.stateAt(line)) last++;
    const target = this.stateAt(line) === 'saved' ? this.opened : this.saved;
    const start = this.model.offsetAt({line: first, character: 0});
    const end = last + 1 < this.model.lineCount ? this.model.offsetAt({line: last + 1, character: 0}) : this.model.length;
    const targetStart = target.offsetAt({line: first, character: 0});
    const targetLines = target.lineCount ?? target.lineStarts.length;
    const targetEnd = last + 1 < targetLines ? target.offsetAt({line: last + 1, character: 0}) : target.length;
    const text = target.getText ? target.getText(targetStart, targetEnd) : target.text.slice(targetStart, targetEnd);
    return {start, end, text};
  }
}

function snapshotLine(snapshot, line) {
  const count = snapshot.lineCount ?? snapshot.lineStarts.length;
  if (line >= count) return null;
  if (snapshot.getLine) return snapshot.getLine(line);
  const start = snapshot.offsetAt({line, character: 0});
  const end = line + 1 < count ? snapshot.offsetAt({line: line + 1, character: 0}) : snapshot.length;
  return snapshot.text.slice(start, end).replace(/[\r\n]+$/, '');
}
