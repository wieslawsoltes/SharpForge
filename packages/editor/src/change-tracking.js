/** Compare touched lines to open/save snapshots. Snapshots share buffer storage rather than copying source. */
export class ChangeTracking {
  constructor(model) { this.model = model; this.opened = model.snapshot(); this.saved = this.opened; this.touched = new Set(); }

  applyChange(event) {
    const spans = changedLineSpans(event);
    const next = new Set();
    for (const line of this.touched) {
      let delta = 0;
      let removed = false;
      for (const span of spans) {
        if (line < span.oldStart) break;
        if (line <= span.oldEnd) { removed = true; break; }
        delta = span.delta;
      }
      if (!removed) next.add(line + delta);
    }
    // New spans already use final coordinates; shifting them again would double-count earlier edits.
    for (const span of spans) for (let line = span.start; line <= span.end; line++) next.add(line);
    this.touched = next;
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

/** Snapshot geometry includes CR/LF joins and splits that counting inserted newline characters misses. */
function changedLineSpans(event) {
  const spans = [];
  let offsetDelta = 0;
  let lineDelta = 0;
  for (const change of [...event.changes].sort((left, right) => left.start - right.start)) {
    const oldStart = change.range?.start.line ?? event.before.positionAt(change.start).line;
    const oldEnd = change.range?.end.line ?? event.before.positionAt(change.end).line;
    const newStart = change.newStart ?? change.start + offsetDelta;
    const newEnd = change.newEnd ?? newStart + change.text.length;
    const start = change.newRange?.start.line ?? event.after.positionAt(newStart).line;
    const end = change.newRange?.end.line ?? event.after.positionAt(newEnd).line;
    // Editing within CRLF can advance newStart past a surviving prefix line. Retain that boundary too.
    spans.push({ oldStart, oldEnd, start: Math.min(start, oldStart + lineDelta), end, delta: end - oldEnd });
    offsetDelta += change.text.length - (change.end - change.start);
    lineDelta = end - oldEnd;
  }
  return spans;
}

function snapshotLine(snapshot, line) {
  const count = snapshot.lineCount ?? snapshot.lineStarts.length;
  if (line >= count) return null;
  if (snapshot.getLine) return snapshot.getLine(line);
  const start = snapshot.offsetAt({line, character: 0});
  const end = line + 1 < count ? snapshot.offsetAt({line: line + 1, character: 0}) : snapshot.length;
  return snapshot.text.slice(start, end).replace(/[\r\n]+$/, '');
}
