export function normalizeEdit(source, edit) {
  const start = edit.start;
  const end = edit.end ?? start + (edit.deleteCount ?? 0);
  const text = edit.text ?? edit.insertText;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) {
    throw new RangeError('Edit contains an invalid UTF-16 range');
  }
  if (typeof text !== 'string') throw new TypeError('Edit text must be a string');
  return {start, end, text};
}

export function checkEditOrder(previous, current) {
  if (previous && (current.start < previous.end || current.start === previous.start)) throw new RangeError('Text edits overlap');
}

export function normalizeEdits(source, edits, limit) {
  if (!Array.isArray(edits) || edits.length > limit) throw new RangeError(`Expected at most ${limit} text edits`);
  const sorted = edits.map(edit => normalizeEdit(source, edit))
    .sort((first, second) => first.start - second.start || first.end - second.end);
  for (let index = 1; index < sorted.length; index++) checkEditOrder(sorted[index - 1], sorted[index]);
  return sorted.filter(edit => edit.start !== edit.end || edit.text.length !== 0);
}

export function createChange(before, after, edit, delta, inverseText) {
  const start = edit.start + delta;
  const end = start + edit.text.length;
  const inverse = Object.freeze({start, end, text: inverseText});
  const range = Object.freeze({start: before.positionAt(edit.start), end: before.positionAt(edit.end)});
  const newRange = Object.freeze({start: after.positionAt(start), end: after.positionAt(end)});
  const change = Object.freeze({...edit, range, newRange, newStart: start, newEnd: end});
  return {change, inverse};
}

export function appendInverse(edits, inverse) {
  const previous = edits.at(-1);
  if (previous && previous.start === previous.end && inverse.start === previous.start) {
    edits[edits.length - 1] = Object.freeze({start: previous.start, end: inverse.end, text: previous.text + inverse.text});
  } else edits.push(inverse);
}

export function createChanges(before, after, edits) {
  let delta = 0;
  const changes = [];
  const inverseEdits = [];
  for (const edit of edits) {
    const next = createChange(before, after, edit, delta, before.getText(edit.start, edit.end));
    changes.push(next.change);
    appendInverse(inverseEdits, next.inverse);
    delta += edit.text.length - (edit.end - edit.start);
  }
  return {changes: Object.freeze(changes), inverseEdits: Object.freeze(inverseEdits)};
}
