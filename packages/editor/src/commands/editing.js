import { adjacentCharacter, adjacentWord } from './movement.js';
import { addAllOccurrences, addNextOccurrence } from './multi-caret.js';
import { copySelections, pasteSelections } from './multi-clipboard.js';

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

function lineGroups(context) {
  const groups = [];
  for (const line of selectedLines(context)) {
    const last = groups.at(-1);
    if (last && last.last + 1 === line) last.last = line;
    else groups.push({ first: line, last: line });
  }
  return groups;
}

export function deleteLines(context) {
  const edits = lineGroups(context).map(({ first, last }) => {
    const start = last === context.lineCount - 1 && first > 0 ? context.lineEnd(first - 1) : context.lineStart(first);
    return { start, deleteCount: context.lineEnd(last, true) - start, text: '' };
  });
  const head = edits[0]?.start ?? 0;
  return context.apply(edits, [{ anchor: head, head }]);
}

export function duplicate(context, direction = 1, wholeLines = false) {
  const edits = [];
  if (!wholeLines && context.selections.some(selection => selection.anchor !== selection.head)) {
    for (const range of ranges(context)) {
      if (range.end > range.start) edits.push({ start: range.end, deleteCount: 0, text: context.slice(range.start, range.end) });
    }
  } else for (const { first, last } of lineGroups(context)) {
    const start = context.lineStart(first);
    const end = context.lineEnd(last, true);
    const content = context.slice(start, end);
    edits.push({ start: direction < 0 ? start : end, deleteCount: 0,
      text: last + 1 < context.lineCount ? content : direction < 0 ? content + context.eol : context.eol + content });
  }
  return context.apply(edits);
}

export function openLine(context, above = false) {
  let delta = 0;
  const selections = [];
  const edits = selectedLines(context).map(line => {
    const start = above ? context.lineStart(line) : context.lineEnd(line);
    const indentation = context.line(line).match(/^[\t ]*/u)[0];
    const text = above ? indentation + context.eol : context.eol + indentation;
    const head = start + delta + (above ? indentation.length : text.length);
    selections.push({ anchor: head, head });
    delta += text.length;
    return { start, deleteCount: 0, text };
  });
  return context.apply(edits, selections);
}

export function changeCase(context, kind) {
  const transform = { upper: value => value.toUpperCase(), lower: value => value.toLowerCase(),
    title: value => value.replace(/\p{L}[\p{L}\p{M}]*/gu, word => word[0].toUpperCase() + word.slice(1).toLowerCase()) }[kind];
  const edits = ranges(context).filter(range => range.end > range.start)
    .map(range => ({ start: range.start, deleteCount: range.end - range.start, text: transform(context.slice(range.start, range.end)) }));
  return context.apply(edits);
}

export function selectNextOccurrence(context, all = false) {
  return (all ? addAllOccurrences : addNextOccurrence)(context.selectionModel);
}

export async function clipboardCommand(context, operation) {
  const capture = context.capture();
  if (operation === 'paste') {
    const text = await context.readClipboard();
    context.assertCurrent(capture, 'reading clipboard');
    if (context.readOnly) return false;
    return pasteSelections(context.selectionModel, text, {
      metadata: context.clipboardPayload?.text === text ? context.clipboardPayload.metadata : undefined,
      tabSize: context.editor.options?.tabSize ?? 4, source: 'paste'
    });
  }
  const payload = copySelections(context.selectionModel, { eol: context.eol });
  const empty = context.selections.every(selection => selection.anchor === selection.head);
  await context.writeClipboard(payload.text);
  context.assertCurrent(capture, 'writing clipboard');
  context.clipboardPayload = payload;
  if (operation === 'cut') return empty ? deleteLines(context) : context.insert('');
  return payload.text;
}
