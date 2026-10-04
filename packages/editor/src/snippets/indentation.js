import {offsetAtVisualColumn, visualColumnAt} from '@sharpforge/text';
import {expandSnippet} from './parser.js';

/** Adapt template terminators and continuation indentation without changing first-line text. */
export function indentSnippet(template, indentation, lineEnding = '\n') {
  return template.replace(/\r\n|\r|\n/g, lineEnding + indentation);
}

const leadingIndentation = text => /^[\t ]*/.exec(text)[0];
const indentationColumns = (text, tabSize) => visualColumnAt(text, text.length, {tabSize});

function removeIndentation(text, columns, tabSize) {
  if (columns === 0) return text;
  const indentation = leadingIndentation(text);
  const position = offsetAtVisualColumn(indentation, columns, {tabSize, bias: 'right'});
  return ' '.repeat(Math.max(0, position.column - columns)) + text.slice(position.offset);
}

function templateIndentation(template, size, options) {
  if (size === undefined) return template;
  if (!Number.isInteger(size) || size < 1 || size > 256) throw new RangeError('Invalid snippet template indentation size');
  const unit = options.insertSpaces === false ? '\t' : ' '.repeat(options.indentSize ?? 4);
  return template.replace(/(^|\r\n|\r|\n)([\t ]+)/g, (_, ending, indentation) => {
    const columns = indentationColumns(indentation, size);
    return ending + unit.repeat(Math.floor(columns / size)) + ' '.repeat(columns % size);
  });
}

function selectedBody(selected, prefix, tabSize) {
  const parts = selected.split(/(\r\n|\r|\n)/);
  const outsideIndentation = leadingIndentation(prefix);
  const beginsInIndentation = outsideIndentation.length === prefix.length;
  if (beginsInIndentation) parts[0] = prefix + parts[0];
  let commonColumns = Infinity;
  let commonIndentation = '';
  for (let index = 0; index < parts.length; index += 2) {
    if (!parts[index].trim()) continue;
    const indentation = leadingIndentation(parts[index]);
    const columns = indentationColumns(indentation, tabSize);
    if (columns >= commonColumns) continue;
    commonColumns = columns;
    commonIndentation = indentation;
  }
  if (!Number.isFinite(commonColumns)) commonColumns = 0;
  const outsideColumns = indentationColumns(outsideIndentation, tabSize);
  const firstIndentation = beginsInIndentation && commonColumns > outsideColumns
    ? removeIndentation(commonIndentation, outsideColumns, tabSize) : '';
  const indentation = outsideIndentation + firstIndentation;
  const normalized = parts.map((part, index) => index % 2 ? part : removeIndentation(part, commonColumns, tabSize));
  return {
    indentation, firstIndentation,
    format({name, value, prefix: output}) {
      if (name !== 'TM_SELECTED_TEXT') return value;
      const lineStart = Math.max(output.lastIndexOf('\n'), output.lastIndexOf('\r')) + 1;
      const context = output.slice(lineStart);
      if (!/^[\t ]*$/.test(context)) return value;
      return normalized.map((part, index) => index % 2 || index === 0 || !part ? part : context + part).join('');
    }
  };
}

/** Prepare against the active model; selected body terminators stay exact while new template lines follow editor options. */
export function prepareSnippetInsertion(editor, template, options = {}) {
  const model = editor.model;
  const start = options.start ?? editor.offset;
  const end = options.end ?? editor.input.selectionEnd ?? start;
  const position = model.positionAt(start);
  const prefix = model.getText(model.getLineStart(position.line), start);
  const variables = {TM_SELECTED_TEXT: options.selected ?? model.getText(start, end),
    TM_FILENAME: editor.uri.split(/[\\/]/).at(-1), ...options.variables};
  const settings = editor.options ?? {};
  const body = options.surround ? selectedBody(String(variables.TM_SELECTED_TEXT ?? ''), prefix, settings.tabSize ?? 4) : null;
  const indentation = body?.indentation ?? leadingIndentation(prefix);
  const eol = settings.endOfLine ?? model.metadata.dominantEol;
  const adapted = templateIndentation(template, options.templateIndentSize, settings);
  const formatted = (body?.firstIndentation ?? '') + indentSnippet(adapted, indentation, eol);
  const expanded = expandSnippet(formatted, variables, {formatVariable: body?.format});
  return {start, end, expanded};
}
