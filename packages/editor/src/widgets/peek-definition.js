import {node, button} from './dom.js';
import {prepareWorkspaceEdit, commitWorkspaceEdit, readWorkspaceDocument} from '../services/workspace-edit.js';

export class PeekDefinitionWidget {
  constructor(context) {
    this.context = context;
    this.element = node(context.document, 'section', {className: 'sf-peek-definition', role: 'region', 'aria-label': 'Peek Definition', hidden: true});
    this.results = node(context.document, 'select', {'aria-label': 'Definition targets'});
    this.status = node(context.document, 'span', {role: 'status'});
    this.content = node(context.document, 'div', {className: 'sf-peek-content'});
    const toolbar = node(context.document, 'header');
    toolbar.append(this.results, button(context.document, 'Open document', () => this.promote()),
      button(context.document, 'Close', () => this.close()), this.status);
    this.element.append(toolbar, this.content);
    context.lifetime.listen(this.results, 'change', () => context.safe(() => this.select(Number(this.results.value))));
    context.lifetime.listen(this.element, 'keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
      context.editor.focus();
    });
  }

  async open() {
    const editor = this.context.editor;
    const offset = editor.offset;
    const result = await this.context.request('definition', {offset, peek: true});
    if (!result || editor.offset !== offset) return;
    const values = result.value?.locations ?? result.value;
    this.locations = (Array.isArray(values) ? values : values ? [values] : []).map(location => ({
      ...location, uri: location.uri ?? location.targetUri, range: location.range ?? location.targetSelectionRange
    }));
    if (!this.locations.length) return this.context.status('No definition was found.');
    this.results.replaceChildren(...this.locations.map((location, index) => node(this.context.document, 'option', {value: index}, location.uri)));
    this.element.hidden = false;
    const line = editor.sourceSnapshot().positionAt(offset).line;
    if (editor.setViewZones) editor.setViewZones('peek', [{afterLine: line, height: this.context.options.peekHeight ?? 240, node: this.element}]);
    else editor.element.append(this.element);
    await this.select(0);
  }

  async select(index) {
    const generation = this.selectionGeneration = (this.selectionGeneration ?? 0) + 1;
    await this.serial;
    if (generation !== this.selectionGeneration || this.element.hidden) return;
    const target = this.locations[index];
    if (!target) return;
    this.selectedIndex = index;
    this.embedded?.dispose();
    this.embedded = null;
    this.content.replaceChildren();
    let document;
    try { document = readWorkspaceDocument(this.context.workspace, target.uri); }
    catch (error) {
      if (!this.context.services.supports('readDocument')) throw error;
      const result = await this.context.request('readDocument', {targetUri: target.uri}, {key: 'peek-document'});
      if (!result || generation !== this.selectionGeneration || this.locations[index] !== target) return;
      if (!result.value || typeof result.value.text !== 'string') throw new Error(`Definition source is unavailable: ${target.uri}`);
      document = {...result.value, uri: target.uri, readOnly: true};
    }
    this.target = {...target, version: document.version, text: document.text};
    const start = target.start ?? (target.range ? this.context.source(document).offsetAt(target.range.start) : 0);
    const end = target.end ?? (target.range ? this.context.source(document).offsetAt(target.range.end) : start);
    if (this.context.options.createEditor) {
      this.embedded = this.context.options.createEditor(this.content, {onChange: text => this.queueEdit(text)});
      this.embedded.setModel(target.uri, document.text);
      this.embedded.setReadOnly(document.readOnly);
      this.embedded.goto(start, end);
    } else {
      this.textarea = node(this.context.document, 'textarea', {'aria-label': `Definition in ${target.uri}`, spellcheck: false});
      this.textarea.value = document.text;
      this.textarea.readOnly = document.readOnly;
      this.textarea.addEventListener('input', () => this.queueEdit(this.textarea.value));
      this.content.append(this.textarea);
      this.textarea.setSelectionRange(start, end);
      this.textarea.focus();
    }
    this.status.textContent = document.readOnly ? 'Read-only source' : 'Edits update the target document';
  }

  queueEdit(text) {
    const target = this.target;
    this.serial = (this.serial ?? Promise.resolve()).then(() => this.context.safe(async () => {
      if (this.target !== target) return;
      const plan = prepareWorkspaceEdit(this.context.workspace, [{uri: target.uri, version: target.version,
        start: 0, end: target.text.length, newText: text, expectedText: target.text}], {label: 'Edit Peek Definition'});
      await commitWorkspaceEdit(this.context.workspace, plan);
      const next = readWorkspaceDocument(this.context.workspace, target.uri);
      target.version = next.version;
      target.text = next.text;
    }));
  }

  promote() {
    if (!this.target) return;
    this.context.navigate(this.target);
    this.close();
  }

  next(direction) {
    if (!this.locations?.length || this.element.hidden) return this.context.status('Open Peek Definition before navigating its targets.');
    const index = ((this.selectedIndex ?? 0) + direction + this.locations.length) % this.locations.length;
    this.results.value = String(index);
    return this.select(index);
  }

  close() {
    this.selectionGeneration = (this.selectionGeneration ?? 0) + 1;
    this.context.guard.cancel('definition');
    this.context.guard.cancel('peek-document');
    this.context.editor.setViewZones?.('peek', []);
    this.element.hidden = true;
    this.embedded?.dispose();
    this.embedded = null;
    this.target = null;
  }

  dispose() { this.close(); this.element.remove(); }
}
