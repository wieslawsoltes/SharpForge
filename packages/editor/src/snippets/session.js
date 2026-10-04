import {expandSnippet} from './parser.js';
import {CSHARP_SNIPPETS} from './builtins.js';
import {EditorPopup, node, button} from '../widgets/dom.js';

export function indentSnippet(template, indentation, lineEnding = '\n') {
  return template.replace(/\r?\n/g, lineEnding + indentation);
}

function eventEdits(change) {
  const items = change?.changes ?? change?.edits ?? [];
  return items.map(edit => ({start: edit.start, end: edit.end ?? edit.start + (edit.deleteCount ?? edit.deleted ?? 0),
    text: edit.text ?? edit.insertText ?? edit.newText ?? ''}));
}

function transformRange(range, edit) {
  const delta = edit.text.length - edit.end + edit.start;
  if (edit.end <= range.start && edit.start < range.start) return {...range, start: range.start + delta, end: range.end + delta};
  if (edit.start >= range.start && edit.end <= range.end) return {...range, end: range.end + delta};
  if (edit.start >= range.end) return range;
  return null;
}

/** Coordinates linked placeholder edits through the editor model; all ranges remain document offsets. */
export class SnippetSession {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'snippet-picker');
    this.active = null;
    this.updating = false;
    this.catalog = [...CSHARP_SNIPPETS, ...(context.options.snippets ?? [])];
  }

  insert(template, options = {}) {
    const editor = this.context.editor;
    if (editor.input.readOnly) return false;
    const start = options.start ?? editor.offset;
    const end = options.end ?? editor.input.selectionEnd;
    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    const indentation = editor.value.slice(lineStart, start).match(/^[\t ]*/)?.[0] ?? '';
    const selected = options.selected ?? editor.value.slice(start, end);
    const lineEnding = editor.value.includes('\r\n') ? '\r\n' : '\n';
    const expanded = expandSnippet(indentSnippet(template, indentation, lineEnding), {TM_SELECTED_TEXT: selected,
      TM_FILENAME: editor.uri.split(/[\\/]/).at(-1), ...options.variables});
    this.stop();
    editor.applyEdits([{start, end, text: expanded.text}], {source: 'snippet', undoStop: true});
    this.active = {uri: editor.uri, order: expanded.order, index: 0,
      stops: new Map([...expanded.stops].map(([key, ranges]) => [key, ranges.map(range => ({...range,
        start: start + range.start, end: start + range.end}))]))};
    this.popup.close();
    this.select();
    return true;
  }

  select() {
    const session = this.active;
    if (!session) return;
    const key = session.order[session.index];
    const ranges = session.stops.get(key);
    if (!ranges?.length) return this.stop();
    this.context.editor.goto(ranges[0].start, ranges[0].end);
    this.context.editor.setDecorations?.('snippet', ranges.map(range => ({...range, className: 'sf-snippet-placeholder'})));
    if (key === 0) this.stop();
    else this.showChoices(ranges[0]);
  }

  showChoices(range) {
    if (!range.choices?.length) return this.popup.close();
    this.popup.element.replaceChildren(node(this.context.document, 'strong', {}, 'Placeholder choices'));
    for (const choice of range.choices) this.popup.element.append(button(this.context.document, choice, () => {
      this.context.editor.insert(choice, range.start, range.end);
      this.popup.close();
      this.context.editor.focus();
    }));
    this.popup.show(range.start);
  }

  changed(change) {
    if (!this.active || this.updating) return;
    if (this.active.uri !== this.context.editor.uri) return this.stop();
    const edits = eventEdits(change).sort((a, b) => b.start - a.start);
    if (!edits.length) return this.stop();
    const key = this.active.order[this.active.index];
    let primary = this.active.stops.get(key)?.[0];
    if (!primary || edits.some(edit => edit.start < primary.start || edit.end > primary.end)) return this.stop();
    if (!this.mapRanges(edits)) return this.stop();
    primary = this.active.stops.get(key)[0];
    const text = this.context.editor.value.slice(primary.start, primary.end);
    const mirrors = this.active.stops.get(key).slice(1).map(range => ({start: range.start, end: range.end, text}));
    if (!mirrors.length) return;
    const selection = {start: this.context.editor.offset, end: this.context.editor.input.selectionEnd};
    this.updating = true;
    try {
      this.context.editor.applyEdits(mirrors, {source: 'snippet-mirror', undoStop: false});
      if (!this.mapRanges(mirrors.sort((a, b) => b.start - a.start))) return this.stop();
      const shift = mirrors.filter(edit => edit.end <= selection.start).reduce((sum, edit) => sum + text.length - edit.end + edit.start, 0);
      this.context.editor.goto(selection.start + shift, selection.end + shift);
    } finally { this.updating = false; }
  }

  beforeEdit() {
    this.editDepth = (this.editDepth ?? 0) + 1;
    const model = this.context.editor.model;
    if (this.active && !this.groupModel && model?.beginUndoGroup) {
      this.groupModel = model;
      model.beginUndoGroup('snippet-input');
    }
  }

  afterEdit() {
    this.editDepth = Math.max(0, (this.editDepth ?? 0) - 1);
    if (!this.editDepth && this.groupModel) {
      this.groupModel.endUndoGroup();
      this.groupModel = null;
    }
  }

  mapRanges(edits) {
    for (const [key, ranges] of this.active.stops) {
      let mapped = ranges;
      for (const edit of edits) mapped = mapped.map(range => range && transformRange(range, edit));
      if (mapped.some(range => !range)) return false;
      this.active.stops.set(key, mapped);
    }
    return true;
  }

  picker(surround = false) {
    const editor = this.context.editor;
    const selection = {start: editor.offset, end: editor.input.selectionEnd};
    const items = this.catalog.filter(item => !surround || item.surround);
    this.popup.element.replaceChildren(node(this.context.document, 'strong', {}, surround ? 'Surround With' : 'Insert Snippet'));
    for (const item of items) this.popup.element.append(button(this.context.document, `${item.prefix} — ${item.label}`, () => {
      const selected = editor.value.slice(selection.start, selection.end);
      const lines = selected.split(/\r?\n/);
      const minimum = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length));
      const normalized = lines.map(line => line.slice(Number.isFinite(minimum) ? minimum : 0)).join('\n    ');
      this.insert(item.body, {...selection, selected: surround ? normalized : selected});
    }));
    this.popup.show();
    this.popup.element.querySelector('button')?.focus();
  }

  keydown(event) {
    if (this.active && event.key === 'Escape') { this.stop(); return true; }
    if (this.active && event.key === 'Tab') {
      this.active.index = Math.max(0, Math.min(this.active.order.length - 1, this.active.index + (event.shiftKey ? -1 : 1)));
      this.select();
      return true;
    }
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const editor = this.context.editor;
    const prefix = editor.value.slice(0, editor.offset).match(/[\p{L}\p{N}_]+$/u)?.[0];
    const snippet = this.catalog.find(item => item.prefix === prefix);
    if (!snippet) { this.pendingPrefix = null; return false; }
    if (this.pendingPrefix === prefix) {
      this.pendingPrefix = null;
      return this.insert(snippet.body, {start: editor.offset - prefix.length, end: editor.offset});
    }
    this.pendingPrefix = prefix;
    this.context.status(`Press Tab again to expand ${prefix}`);
    return true;
  }

  stop() {
    this.active = null;
    this.context.editor.setDecorations?.('snippet', []);
    this.popup.close();
  }

  dispose() { this.stop(); this.popup.dispose(); }
}
