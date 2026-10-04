import {SourceText} from '@sharpforge/text';
import {SyntaxHighlightIndex} from './highlight.js';
import {sourceChange} from './source-change.js';
import {escapeHtml} from './html.js';

const diagnosticKey = diagnostics => JSON.stringify(diagnostics.map(item => [item.start, item.length, item.severity, item.range?.start.line]));
const setStyle = (element, name, value) => { if (element.style[name] !== value) element.style[name] = value; };
const setHidden = (element, value) => { if (element.hidden !== value) element.hidden = value; };

/** Owns the existing native-textarea overlay and gutter. No second text model or whole-document DOM is created. */
export class EditorViewport {
  constructor(editor) {
    this.editor = editor;
    this.height = editor.element.clientHeight;
    this.diagnosticsKey = '';
    this.window = null;
    this.windowInput = null;
    this.highlightMarkup = null;
    this.pendingChange = null;
    this.updateDepth = 0;
    this.pendingSync = false;
    this.currentLine = editor.element.querySelector('.sf-current-line');
    this.selectedLine = editor.element.querySelector('.sf-selected-frame-line');
    this.executionLine = editor.element.querySelector('.sf-execution-line');
  }

  sourceSnapshot() {
    const editor = this.editor;
    const text = editor.value;
    const previous = editor.cachedSource;
    if (previous?.text === text && previous.uri === editor.uri) return previous;
    if (previous?.uri === editor.uri) {
      const change = sourceChange(previous.text, text);
      editor.cachedSource = previous.withChange(change.start, change.length, text.slice(change.start, change.start + change.newLength));
      this.pendingChange = {previous, source: editor.cachedSource, change};
    } else {
      editor.cachedSource = new SourceText(text, editor.uri);
      this.pendingChange = null;
    }
    return editor.cachedSource;
  }

  resize() {
    if (this.editor.disposed) return;
    this.height = this.editor.element.clientHeight;
    this.sync();
  }

  /** Batches DOM work only; source and diagnostic preparation remain synchronous inside callbacks. */
  batch(action) {
    this.updateDepth++;
    try {
      return action();
    } finally {
      this.updateDepth--;
      if (this.updateDepth === 0 && this.pendingSync) {
        this.pendingSync = false;
        this.sync();
      }
    }
  }

  paint() {
    const editor = this.editor;
    if (editor.disposed) return;
    const source = this.sourceSnapshot();
    if (editor.highlightIndex?.source !== source) {
      const previous = editor.highlightIndex;
      const pending = this.pendingChange;
      const change = pending && pending.previous === previous?.source && pending.source === source ? pending.change : null;
      editor.highlightIndex = previous ? previous.withSource(source, change) : new SyntaxHighlightIndex(source);
      editor.selectionHistory = [];
      editor.highlightWindowKey = null;
      this.pendingChange = null;
    }
    const signature = diagnosticKey(editor.diagnostics);
    if (this.diagnosticsKey !== signature) {
      this.diagnosticsKey = signature;
      editor.highlightWindowKey = null;
    }
    editor.lexed = editor.highlightIndex.lexed;
    editor.lexedSource = source;
    editor.pairs = editor.highlightIndex.brackets;
    editor.lineCount = source.lineStarts.length;
    this.sync();
  }

  segment(text, start, kind = '') {
    if (!text) return '';
    const diagnostics = this.editor.diagnostics.filter(item => item.length > 0 && item.start < start + text.length && item.start + item.length > start);
    const point = this.editor.executionPoint;
    const active = Number.isInteger(point?.start) && point.start < start + text.length && point.end > start;
    if (!diagnostics.length && !active) return kind ? `<span class="tok-${kind}">${escapeHtml(text)}</span>` : escapeHtml(text);
    const cuts = new Set([0, text.length]);
    for (const item of diagnostics) {
      cuts.add(Math.max(0, item.start - start));
      cuts.add(Math.min(text.length, item.start + item.length - start));
    }
    if (active) {
      cuts.add(Math.max(0, point.start - start));
      cuts.add(Math.min(text.length, point.end - start));
    }
    const points = [...cuts].sort((a, b) => a - b);
    return points.slice(0, -1).map((a, index) => {
      const b = points[index + 1];
      const covering = diagnostics.filter(item => item.start < start + b && item.start + item.length > start + a);
      const item = covering.find(item => (item.severity ?? 'error') === 'error') ?? covering[0];
      const current = active && point.start < start + b && point.end > start + a;
      const squiggle = item ? (item.severity ?? 'error') === 'error' ? 'sf-squiggle' : 'sf-squiggle sf-squiggle-warning' : '';
      return `<span class="${kind ? 'tok-' + kind : ''} ${squiggle} ${current ? 'sf-current-statement' : ''}">${escapeHtml(text.slice(a, b))}</span>`;
    }).join('');
  }

  trivia(text, start) {
    let result = '';
    let offset = 0;
    for (const match of text.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)) {
      result += this.segment(text.slice(offset, match.index), start + offset);
      result += this.segment(match[0], start + match.index, 'comment');
      offset = match.index + match[0].length;
    }
    return result + this.segment(text.slice(offset), start + offset);
  }

  paintViewport() {
    const editor = this.editor;
    if (editor.disposed || !editor.highlightIndex) return;
    const inputKey = [editor.input.scrollTop, this.height, editor.lineHeight, editor.padding].join(':');
    if (this.windowIndex !== editor.highlightIndex || this.windowInput !== inputKey) {
      this.window = editor.highlightIndex.window({
        scrollTop: editor.input.scrollTop, height: this.height, lineHeight: editor.lineHeight, padding: editor.padding
      });
      this.windowIndex = editor.highlightIndex;
      this.windowInput = inputKey;
    }
    const window = this.window;
    const key = window.start + ':' + window.end;
    if (editor.highlightWindowKey !== key) {
      const text = editor.highlightIndex.source.text;
      const markup = window.runs.map(run => {
        const html = this.segment(text.slice(run.start, run.end), run.start, run.kind);
        return run.bracket ? `<span data-bracket="${run.start}">${html}</span>` : html;
      }).join('') + (window.end === text.length ? '\n' : '');
      if (this.highlightMarkup !== markup) {
        editor.highlight.innerHTML = markup;
        this.highlightMarkup = markup;
        editor.bracketElements = new Map([...editor.highlight.querySelectorAll('[data-bracket]')].map(element => [Number(element.dataset.bracket), element]));
        editor.lastBracketElements = [];
      }
      editor.highlightWindowKey = key;
    }
    setStyle(editor.highlight, 'transform', `translate(${-editor.input.scrollLeft}px,${window.firstLine * editor.lineHeight - editor.input.scrollTop}px)`);
    editor.highlightMetrics = {
      firstLine: window.firstLine, lastLine: window.lastLine, paintedCharacters: window.characters,
      paintedRuns: window.runs.length, totalTokens: editor.highlightIndex.tokenCount, syntax: window.syntax
    };
    this.markBrackets();
  }

  markBrackets() {
    const editor = this.editor;
    const at = editor.pairs?.has(editor.offset) ? editor.offset : editor.offset - 1;
    const next = [editor.bracketElements?.get(at), editor.bracketElements?.get(editor.pairs?.get(at))].filter(Boolean);
    const previous = editor.lastBracketElements ?? [];
    if (next.length === previous.length && next.every((element, index) => element === previous[index])) return;
    for (const element of previous) element.classList.remove('sf-bracket-match');
    for (const element of next) element.classList.add('sf-bracket-match');
    editor.lastBracketElements = next;
  }

  gutter(top, current) {
    const editor = this.editor;
    const first = Math.max(1, Math.floor((top - editor.padding) / editor.lineHeight));
    const last = Math.min(editor.lineCount ?? 1, first + Math.ceil(this.height / editor.lineHeight) + 3);
    const breakpoints = new Map();
    for (const item of editor.breakpoints) if (!breakpoints.has(item.line)) breakpoints.set(item.line, item);
    const diagnostics = new Map();
    for (const item of editor.diagnostics) {
      const line = item.range?.start.line;
      if (!diagnostics.has(line) || (item.severity ?? 'error') === 'error') diagnostics.set(line, item.severity ?? 'error');
    }
    let rows = '';
    for (let line = first; line <= last; line++) {
      const breakpoint = breakpoints.get(line);
      const diagnostic = diagnostics.get(line - 1);
      const hasDiagnostic = diagnostics.has(line - 1);
      const classes = ['sf-line', line === current ? 'current' : '', breakpoint ? 'breakpoint' : '',
        breakpoint?.verified === false ? 'pending' : '', breakpoint?.enabled === false || breakpoint?.muted ? 'disabled-breakpoint' : '',
        line === editor.executionLine ? 'execution' : '', line === editor.selectedFrameLine ? 'selected-frame' : '',
        hasDiagnostic ? diagnostic === 'error' ? 'error' : 'warning' : ''].join(' ');
      const prefix = line === editor.executionLine ? (editor.executionDetails?.description ?? 'Execution position') + ' · ' :
        line === editor.selectedFrameLine ? 'Selected caller (not executing) · ' : '';
      const action = breakpoint ? breakpoint.enabled === false ? 'Disabled breakpoint' : 'Remove breakpoint' : 'Set breakpoint';
      const title = prefix + (breakpoint?.message ?? action);
      rows += `<button type="button" class="${classes}" data-line="${line}" ` +
        `style="top:${editor.padding + (line - 1) * editor.lineHeight - top}px" title="${escapeHtml(title)} at line ${line}" ` +
        `aria-label="${breakpoint ? 'Remove' : 'Set'} breakpoint at line ${line}"><i></i><span>${line}</span></button>`;
    }
    if (editor.gutterMarkup !== rows) {
      editor.gutter.innerHTML = rows;
      editor.gutterMarkup = rows;
    }
  }

  sync() {
    const editor = this.editor;
    if (editor.disposed) return;
    if (this.updateDepth > 0) {
      this.pendingSync = true;
      return;
    }
    if (editor.keymapAdapter) {
      editor.keymapAdapter.decorate();
      if (editor.keymapAdapter.doc !== editor.element.ownerDocument) editor.setKeymap(editor.keymap);
      return;
    }
    const top = editor.input.scrollTop;
    this.paintViewport();
    const current = this.sourceSnapshot().positionAt(editor.offset).line + 1;
    this.gutter(top, current);
    setStyle(this.currentLine, 'top', editor.padding + (current - 1) * editor.lineHeight - top + 'px');
    setHidden(this.selectedLine, !editor.selectedFrameLine);
    if (editor.selectedFrameLine) setStyle(this.selectedLine, 'top', editor.padding + (editor.selectedFrameLine - 1) * editor.lineHeight - top + 'px');
    setHidden(this.executionLine, !editor.executionLine);
    if (editor.executionLine) setStyle(this.executionLine, 'top', editor.padding + (editor.executionLine - 1) * editor.lineHeight - top + 'px');
  }

  dispose() {
    this.window = null;
    this.windowIndex = null;
    this.pendingChange = null;
    this.pendingSync = false;
    this.highlightMarkup = null;
  }
}
