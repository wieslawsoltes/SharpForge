import {lexicalContext} from '../operations.js';

const pairs = Object.freeze({'(': ')', '[': ']', '{': '}', '"': '"', "'": "'"});

/** Finds the relevant cached token in logarithmic time before inspecting trivia or a literal. */
export function cachedLexicalContext(editor, offset) {
  if (editor.lexicalContext) return editor.lexicalContext(offset);
  const tokens = editor.lexed?.tokens;
  if (!tokens?.length) return 'unknown';
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((tokens.get?.(middle) ?? tokens[middle]).end < offset) low = middle + 1;
    else high = middle;
  }
  const nearby = [];
  for (let index = Math.max(0, low - 1); index < Math.min(tokens.length, low + 2); index++) {
    nearby.push(tokens.get?.(index) ?? tokens[index]);
  }
  return lexicalContext(editor.value, offset, nearby);
}

export function smartNewline(text, start, end = start, options = {}) {
  const lineStart = Math.max(text.lastIndexOf('\n', start - 1), text.lastIndexOf('\r', start - 1)) + 1;
  const prefix = text.slice(lineStart, start);
  const indent = prefix.match(/^[\t ]*/)?.[0] ?? '';
  const unit = options.insertSpaces === false ? '\t' : ' '.repeat(options.tabSize ?? 4);
  const eol = options.lineEnding ?? (text.includes('\r\n') ? '\r\n' : '\n');
  const extra = /[{[(]\s*$/.test(prefix) ? unit : '';
  if (extra && /^[\t ]*[}\])]/.test(text.slice(end))) {
    const textValue = eol + indent + extra + eol + indent;
    return {text: textValue, caret: start + eol.length + indent.length + extra.length};
  }
  const textValue = eol + indent + extra;
  return {text: textValue, caret: start + textValue.length};
}

export class SmartTyping {
  constructor(context) {
    this.context = context;
    this.autoPairs = [];
  }

  keydown(event) {
    const editor = this.context.editor;
    if (editor.input.readOnly || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
    if (editor.getSelections?.().length > 1) return false;
    const start = editor.offset;
    const end = editor.input.selectionEnd;
    const context = cachedLexicalContext(editor, start);
    const tracked = this.autoPairs.find(pair => pair.close === start && pair.character === event.key);
    if (tracked && start === end && editor.value[start] === event.key) {
      this.autoPairs = this.autoPairs.filter(pair => pair !== tracked);
      editor.goto(start + 1);
      return true;
    }
    if (event.key === 'Backspace' && start === end) {
      const pair = this.autoPairs.find(pair => pair.open === start - 1 && pair.close === start);
      if (pair) {
        this.autoPairs = this.autoPairs.filter(item => item !== pair);
        editor.insert('', start - 1, start + 1);
        return true;
      }
    }
    if (event.key === '/' && this.documentationComment(start)) return true;
    if (context !== 'code') return false;
    if (pairs[event.key]) {
      const selected = editor.value.slice(start, end);
      editor.insert(event.key + selected + pairs[event.key], start, end, start + 1 + selected.length);
      this.autoPairs.push({open: start, close: start + 1 + selected.length, character: pairs[event.key]});
      if (this.autoPairs.length > 256) this.autoPairs.shift();
      return true;
    }
    if (event.key === 'Enter') {
      const insertion = smartNewline(editor.value, start, end, this.context.options);
      editor.insert(insertion.text, start, end, insertion.caret);
      return true;
    }
    if ([')', ']', '}'].includes(event.key) && start === end && editor.value[start] === event.key) {
      editor.goto(start + 1);
      return true;
    }
    return false;
  }

  documentationComment(start) {
    if (this.context.options.documentationComments === false) return false;
    const editor = this.context.editor;
    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    if (!/^[\t ]*\/\/$/.test(editor.value.slice(lineStart, start))) return false;
    this.context.snippets.insert('/ <summary>\n/// ${1}\n/// </summary>$0', {start, end: editor.input.selectionEnd});
    return true;
  }

  changed(change) {
    const edits = change?.changes ?? change?.edits;
    if (!Array.isArray(edits)) { this.autoPairs = []; return; }
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      const end = edit.end ?? edit.start + (edit.deleteCount ?? edit.deleted ?? 0);
      const text = edit.text ?? edit.insertText ?? edit.newText ?? '';
      const delta = text.length - end + edit.start;
      this.autoPairs = this.autoPairs.filter(pair => !(edit.start <= pair.open && end > pair.open) && !(edit.start <= pair.close && end > pair.close))
        .map(pair => ({...pair, open: pair.open >= end ? pair.open + delta : pair.open,
          close: pair.close >= end ? pair.close + delta : pair.close}));
    }
  }
}
