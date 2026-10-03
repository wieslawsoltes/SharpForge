import { adjacentCharacter, adjacentWord } from './movement.js';

function ranges(context) {
  return context.selections.map(selection => ({
    start: Math.min(selection.anchor, selection.head), end: Math.max(selection.anchor, selection.head)
  }));
}

export function deleteSelections(context, direction, word = false) {
  if (typeof context.editor.deleteText === 'function') return context.editor.deleteText(direction, { word });
  const raw = ranges(context).map(range => {
    if (range.start !== range.end) return { start: range.start, deleteCount: range.end - range.start, text: '' };
    const next = word ? adjacentWord(context, range.start, direction) : adjacentCharacter(context, range.start, direction);
    return { start: Math.min(range.start, next), deleteCount: Math.abs(next - range.start), text: '' };
  }).sort((left, right) => left.start - right.start);
  const edits = [];
  for (const edit of raw) {
    const previous = edits.at(-1);
    if (previous && edit.start <= previous.start + previous.deleteCount) {
      previous.deleteCount = Math.max(previous.start + previous.deleteCount, edit.start + edit.deleteCount) - previous.start;
    } else edits.push(edit);
  }
  let delta = 0;
  const selections = edits.map(edit => {
    const head = edit.start - delta;
    delta += edit.deleteCount;
    return { anchor: head, head };
  });
  return context.apply(edits.filter(edit => edit.deleteCount), selections);
}

export function selectedLines(context) {
  const lines = new Set();
  for (const range of ranges(context)) {
    const first = context.position(range.start).line;
    const last = context.position(range.end).line;
    for (let line = first; line <= last; line++) {
      if (line === last && line !== first && range.end === context.lineStart(line)) break;
      lines.add(line);
    }
  }
  return [...lines].sort((left, right) => left - right);
}

export function transformLines(context, transform) {
  const edits = selectedLines(context).map(line => ({
    start: context.lineStart(line), deleteCount: context.line(line).length, text: transform(context.line(line), line)
  }));
  return context.apply(edits, undefined);
}

export function indent(context, outdent = false) {
  const size = context.editor.options?.tabSize ?? 4;
  const text = context.editor.options?.insertSpaces === false ? '\t' : ' '.repeat(size);
  if (!outdent && context.selections.every(selection => selection.anchor === selection.head)) return context.insert(text);
  return transformLines(context, line => outdent ? line.replace(new RegExp(`^(?: {1,${size}}|\\t)`), '') : text + line);
}

export function deleteLines(context) {
  const lines = selectedLines(context);
  const edits = [];
  for (const line of lines) {
    const start = context.lineStart(line);
    const end = context.lineEnd(line, true);
    const previous = edits.at(-1);
    if (previous && previous.start + previous.deleteCount === start) previous.deleteCount += end - start;
    else edits.push({ start, deleteCount: end - start, text: '' });
  }
  return context.apply(edits, [{ anchor: edits[0]?.start ?? 0, head: edits[0]?.start ?? 0 }]);
}

export function duplicate(context, direction = 1) {
  const edits = [];
  for (const range of ranges(context)) {
    const line = context.position(range.start).line;
    if (range.start !== range.end) edits.push({ start: range.end, deleteCount: 0, text: context.slice(range.start, range.end) });
    else {
      const start = context.lineStart(line);
      const end = context.lineEnd(line, true);
      const newline = context.editor.options?.eol ?? '\n';
      const content = context.slice(start, end);
      edits.push({ start: direction < 0 ? start : end, deleteCount: 0,
        text: line + 1 < context.lineCount ? content : direction < 0 ? content + newline : newline + content });
    }
  }
  return context.apply(edits);
}

export function openLine(context, above = false) {
  const position = context.position(context.selection.head);
  const start = above ? context.lineStart(position.line) : context.lineEnd(position.line);
  const indentation = context.line(position.line).match(/^\s*/u)[0];
  const newline = context.editor.options?.eol ?? '\n';
  const text = above ? indentation + newline : newline + indentation;
  const head = start + (above ? indentation.length : text.length);
  return context.apply([{ start, deleteCount: 0, text }], [{ anchor: head, head }]);
}

export function changeCase(context, kind) {
  const transform = { upper: value => value.toUpperCase(), lower: value => value.toLowerCase(),
    title: value => value.replace(/\p{L}[\p{L}\p{M}]*/gu, word => word[0].toUpperCase() + word.slice(1).toLowerCase()) }[kind];
  const edits = ranges(context).filter(range => range.end > range.start)
    .map(range => ({ start: range.start, deleteCount: range.end - range.start, text: transform(context.slice(range.start, range.end)) }));
  return context.apply(edits);
}

export function selectNextOccurrence(context, all = false) {
  const selections = context.selections;
  const primary = selections[0];
  let start = Math.min(primary.anchor, primary.head);
  let end = Math.max(primary.anchor, primary.head);
  if (start === end) {
    const position = context.position(start);
    const lineStart = context.lineStart(position.line);
    const text = context.line(position.line);
    let left = position.character;
    let right = left;
    while (left && /[\p{L}\p{N}_]/u.test(text[left - 1])) left--;
    while (right < text.length && /[\p{L}\p{N}_]/u.test(text[right])) right++;
    context.select([{ anchor: lineStart + left, head: lineStart + right }]);
    return;
  }
  const query = context.slice(start, end);
  const text = context.slice();
  const used = new Set(selections.map(selection => `${Math.min(selection.anchor, selection.head)}:${Math.max(selection.anchor, selection.head)}`));
  let offset = all ? 0 : Math.max(...selections.map(selection => Math.max(selection.head, selection.anchor)));
  const added = [];
  for (let scan = 0; scan < 2 && added.length < 1000; scan++) {
    let match;
    while ((match = text.indexOf(query, offset)) !== -1) {
      offset = match + query.length;
      if (used.has(`${match}:${offset}`)) continue;
      added.push({ anchor: match, head: offset });
      if (!all) break;
      if (added.length >= 1000) break;
    }
    if (added.length || all) break;
    offset = 0;
  }
  if (added.length) context.select([...selections, ...added]);
}

export async function clipboardCommand(context, operation) {
  if (operation === 'paste') {
    const uri = context.uri;
    const version = context.buffer?.version;
    const text = await context.readClipboard();
    if (uri !== context.uri || version !== context.buffer?.version) throw new Error('Document changed while reading clipboard');
    return context.insert(text);
  }
  const selected = ranges(context);
  const empty = selected.every(range => range.start === range.end);
  const text = empty ? selectedLines(context).map(line => context.slice(context.lineStart(line), context.lineEnd(line, true))).join('')
    : selected.map(range => context.slice(range.start, range.end)).join('\n');
  const uri = context.uri;
  const version = context.buffer?.version;
  const selection = JSON.stringify(context.selections);
  await context.writeClipboard(text);
  if (operation === 'cut') {
    if (uri !== context.uri || version !== context.buffer?.version || selection !== JSON.stringify(context.selections)) {
      throw new Error('Document or selection changed while writing clipboard');
    }
    return empty ? deleteLines(context) : context.insert('');
  }
  return text;
}
