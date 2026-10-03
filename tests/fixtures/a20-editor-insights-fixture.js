import {SourceText} from '@sharpforge/text';
import {lex} from '@sharpforge/syntax';
import {EditorModel} from '../../packages/editor/src/model.js';
import {EditorLanguageServices, EditorModelWorkspace} from '../../packages/editor/src/services/index.js';
import {createEditorInsights} from '../../packages/editor/src/features/index.js';

const element = document.querySelector('#editor');
const input = document.querySelector('#source');
let current;

class FixtureEditor {
  constructor(text) {
    this.element = element;
    this.input = input;
    this.uri = 'a.cs';
    this.model = new EditorModel(text, {uri: this.uri});
    this.decorations = new Map();
    this.zones = new Map();
    this.widgets = new Map();
    this.lineHeight = 22;
    this.view = {coordsAt: offset => {
      const position = this.sourceSnapshot().positionAt(offset);
      return {left: 20 + position.character * 8, top: 28 + position.line * 22, height: 22, local: true};
    }, positionAt: (x, y) => this.sourceSnapshot().offsetAt({line: Math.max(0, Math.floor((y - 58) / 22)),
      character: Math.max(0, Math.floor((x - 50) / 8))}), render: () => this.paint()};
    this.model.onDidChange(change => {
      input.value = this.value;
      const selection = this.model.primarySelection;
      input.setSelectionRange(Math.min(selection.anchor, selection.active), Math.max(selection.anchor, selection.active));
      this.paint();
      this.insights?.changed(change);
    });
    this.paint();
  }

  get value() { return this.model.value; }
  get offset() { return input.selectionStart; }
  sourceSnapshot() { return new SourceText(this.value, this.uri, this.model.version); }
  paint() { input.value = this.value; this.lexed = lex(this.sourceSnapshot()); }
  focus() { input.focus(); }
  getSelections() { return this.model.selections; }
  goto(start, end = start) {
    input.setSelectionRange(start, end);
    this.model.setSelections([{anchor: start, active: end}]);
    this.insights?.cursor();
  }
  applyEdits(edits, options = {}) {
    const selection = this.nativeSelection ?? {start: input.selectionStart, end: input.selectionEnd};
    this.nativeSelection = null;
    this.model.setSelections([{anchor: selection.start, active: selection.end}], {notify: false});
    this.insights?.beforeEdit({edits, options});
    try { return this.model.applyEdits(edits, options); }
    finally { this.insights?.afterEdit({edits, options}); }
  }
  insert(text, start = input.selectionStart, end = input.selectionEnd, caret) {
    this.applyEdits([{start, end, text}], {source: 'typing'});
    this.goto(caret ?? start + text.length);
  }
  setDecorations(owner, values) { this.decorations.set(owner, values); }
  setInlineWidgets(owner, values) { this.widgets.set(owner, values); }
  setViewZones(owner, values) {
    this.zones.set(owner, values);
    const host = document.querySelector('#zones');
    host.replaceChildren(...[...this.zones.values()].flat().map(zone => {
      zone.node.style.height = `${zone.height}px`;
      return zone.node;
    }));
  }
  request(method, parameters) { window.commands.push({method, parameters}); return null; }
}

window.setup = (text = 'value + value', options = {}) => {
  current?.insights.dispose();
  current?.model.dispose();
  document.querySelector('#zones').replaceChildren();
  window.commands = [];
  window.errors = [];
  window.resolves = 0;
  const editor = new FixtureEditor(text);
  const models = new Map([['a.cs', editor.model], ['b.cs', new EditorModel('value target', {uri: 'b.cs'})],
    ['c.cs', new EditorModel('value third', {uri: 'c.cs'})]]);
  const workspace = new EditorModelWorkspace(models);
  const providers = {
    completion: () => [{label: 'ReadLine', kind: 'method', detail: 'string Console.ReadLine()', documentation: 'Reads a line.', commitCharacters: ['(']},
      {label: 'Read', kind: 'method'}, {label: 'Range', kind: 'class'}],
    hover: () => ({contents: 'int value', documentation: '<img src=x onerror=alert(1)> Plain documentation'}),
    signatureHelp: () => ({signatures: [{label: 'void F(int x, string y)', parameters: [{label: 'int x'}, {label: 'string y', documentation: 'Second argument'}]},
      {label: 'void F(double x)', parameters: [{label: 'double x'}]}]}),
    diagnostics: parameters => [{uri: parameters.uri, version: parameters.version, start: 0, length: 5, message: 'Example diagnostic', code: 'CS0001'}],
    codeActions: parameters => [{title: 'Replace first word', edits: [{uri: parameters.uri, version: parameters.version,
      start: 0, end: Math.min(5, editor.value.length), newText: 'fixed'}], fixAllScopes: ['document', 'project', 'solution']}],
    rename: parameters => workspace.listDocuments().flatMap(document => [...document.text.matchAll(/\bvalue\b/g)].map(match => ({
      uri: document.uri, version: document.version, start: match.index, end: match.index + 5, newText: parameters.newName
    }))),
    definition: () => [{uri: 'b.cs', start: 0, end: 5}, {uri: 'c.cs', start: 0, end: 5}],
    documentSymbols: () => [{name: 'C', kind: 'class', start: 0, end: editor.value.length},
      {name: 'Method', kind: 'method', owner: 'C', start: Math.min(6, editor.value.length), end: editor.value.length}],
    documentHighlights: () => [...editor.value.matchAll(/\bvalue\b/g)].map(match => ({start: match.index, end: match.index + 5})),
    inlayHints: () => [{offset: 0, label: 'parameter:', kind: 2}],
    codeLens: () => [{start: 0, end: 5}],
    resolveCodeLens: () => { window.resolves++; return {command: {title: '3 references', command: 'references'}}; },
    semanticTokens: () => [{start: 0, end: Math.min(5, editor.value.length), kind: 'local'}],
    format: parameters => ({edits: [{uri: parameters.uri, version: parameters.version, start: 0, end: editor.value.length,
      newText: editor.value.replace(/^ +/gm, '')}]})
  };
  const services = new EditorLanguageServices(providers);
  editor.insights = createEditorInsights(editor, {services, workspace, analysisDelay: 20,
    formatOnType: false, formatOnPaste: false, formatOnCompletion: false, onError: error => window.errors.push(error.message), ...options});
  editor.goto(0);
  current = editor;
  window.editor = editor;
  window.models = models;
  window.insights = editor.insights;
  window.fixtureServices = services;
  return true;
};

input.addEventListener('keydown', event => {
  if (current?.insights.keydown(event)) event.preventDefault();
});
input.addEventListener('beforeinput', event => {
  if (!current) return;
  current.insights.beforeinput(event);
  current.nativeSelection = {start: input.selectionStart, end: input.selectionEnd};
});
input.addEventListener('input', () => {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const before = current.value;
  const after = input.value;
  let first = 0;
  while (first < before.length && first < after.length && before[first] === after[first]) first++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  current.applyEdits([{start: first, end: oldEnd, text: after.slice(first, newEnd)}],
    {source: 'typing', command: 'typing', selections: [{anchor: start, active: end}]});
});
window.setup();
