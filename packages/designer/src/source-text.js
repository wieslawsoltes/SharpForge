import {lex} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {failSource} from './source-errors.js';

export const sourcePath = node => node?.kind === 'Name' ? node.name
  : node?.kind === 'Member' && sourcePath(node.target) ? sourcePath(node.target) + '.' + node.name : null;
export const sameSourceValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const sourceIdentifier = id => 'v_' + id.replace(/[^A-Za-z0-9_]/g, '_');
export const designIdentifier = name => name.startsWith('v_') ? name.slice(2) : name.replace(/[^A-Za-z0-9_]/g, '_');

/** Applies disjoint UTF-16 edits atomically; no partial result escapes on an invalid range. */
export function applySourceEdits(text, edits) {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  let end = 0;
  const chunks = [];
  for (const edit of ordered) {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || typeof edit.text !== 'string'
      || edit.start < end || edit.start < 0 || edit.end < edit.start || edit.end > text.length) {
      failSource('Overlapping or invalid C# source edits', edit, 'SFSYNC_CONFLICT');
    }
    chunks.push(text.slice(end, edit.start), edit.text);
    end = edit.end;
  }
  chunks.push(text.slice(end));
  return chunks.join('');
}

export function sourceComments(text) {
  return lex(new SourceText(text)).tokens.flatMap(token => token.green.leading.match(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g) ?? []);
}

export function inferSourceStyle(text, method) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lineStart = text.lastIndexOf('\n', method.start - 1) + 1;
  const methodIndent = text.slice(lineStart, method.start).match(/^[ \t]*/)?.[0] ?? '';
  const statements = method.body.statements ?? [];
  const indents = statements.map(statement => {
    const prefix = text.slice(text.lastIndexOf('\n', statement.start - 1) + 1, statement.start);
    return /^[ \t]+$/.test(prefix) ? prefix : null;
  }).filter(Boolean);
  const indent = indents[0] ?? methodIndent + (text.includes('\t') ? '\t' : '    ');
  const unit = indent.startsWith(methodIndent) ? indent.slice(methodIndent.length) || '    ' : '    ';
  const locals = statements.filter(statement => statement.kind === 'Local').flatMap(statement => statement.declarations);
  const usesVar = locals.filter(declaration => declaration.type === 'var').length > locals.length / 2;
  return {newline, indent, methodIndent, unit, usesVar, braceOnNewLine: /\r?\n[ \t]*\{$/.test(text.slice(method.start, method.body.start + 1))};
}

/** Construction edits precede the proved adaptive initializer and the method's terminal action. */
export function sourceConstructionBoundary(analysis) {
  const terminal = analysis.method.body.statements.find(statement => statement.kind === 'Return'
    || statement.expression?.kind === 'Call' && statement.expression.target?.name === 'Activate');
  return Math.min(analysis.responsiveSource?.initializer.start ?? Infinity,
    terminal?.start ?? analysis.method.body.end - 1);
}

/** Insertion preserves existing indentation, including same-line construction methods. */
export function sourceInsertion(analysis, statements, offset = null) {
  if (!statements.length) return null;
  const {text, method} = analysis;
  const style = analysis.style ?? inferSourceStyle(text, method);
  const at = offset ?? sourceConstructionBoundary(analysis);
  const prefix = text.slice(text.lastIndexOf('\n', at - 1) + 1, at);
  const padding = /^[ \t]*$/.test(prefix) ? '' : style.newline + style.indent;
  const continuation = /^[ \t]*$/.test(prefix) ? prefix : style.indent;
  return {start: at, end: at, text: padding + statements.join(style.newline + style.indent) + style.newline + continuation};
}

export function removeSourceStatement(analysis, statement) {
  return {start: statement.start, end: statement.end, text: '', deletion: true};
}

export function removeSourceInitializer(analysis, entry) {
  const initializer = entry.initializer;
  const tokens = analysis.parsed.tokens;
  const after = tokens.find(token => token.start >= initializer.expression.end);
  const before = tokens.filter(token => token.end <= initializer.start).at(-1);
  if (after?.kind === ',') return {start: initializer.start, end: after.end, text: '', deletion: true};
  if (before?.kind === ',') return {start: before.start, end: initializer.expression.end, text: '', deletion: true};
  return {start: initializer.start, end: initializer.expression.end, text: '', deletion: true};
}

/** Merge only deleted spans; comments in the deleted statements survive at their original boundary. */
export function coalesceSourceEdits(analysis, edits) {
  const deletions = [];
  const insertions = new Map();
  for (const edit of edits.filter(Boolean).sort((left, right) => left.start - right.start)) {
    if (edit.deletion) {
      const previous = deletions.at(-1);
      if (previous && edit.start <= previous.end) previous.end = Math.max(previous.end, edit.end);
      else deletions.push({...edit});
    } else if (edit.start === edit.end) {
      const previous = insertions.get(edit.start);
      if (previous) previous.text += edit.text;
      else insertions.set(edit.start, {...edit});
    }
  }
  const newline = analysis.style?.newline ?? '\n';
  for (const deletion of deletions) {
    deletion.text = sourceComments(analysis.text.slice(deletion.start, deletion.end))
      .map(comment => comment.startsWith('//') ? comment + newline : comment).join(' ');
  }
  return [...edits.filter(edit => edit && !edit.deletion && edit.start !== edit.end), ...insertions.values(), ...deletions];
}
