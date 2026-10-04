import {EditorPopup, node, button, checkbox, labeledInput} from './dom.js';
import {prepareWorkspaceEdit, commitWorkspaceEdit} from '../services/workspace-edit.js';
import {RenamePreview} from '../features/rename-preview.js';

export class InlineRenameWidget {
  constructor(context) {
    this.context = context;
    this.popup = new EditorPopup(context, 'inline-rename');
    const field = labeledInput(context.document, 'New symbol name', {autocomplete: 'off', spellcheck: false});
    this.input = field.input;
    this.comments = checkbox(context.document, 'Include comments');
    this.strings = checkbox(context.document, 'Include strings');
    this.renameFile = checkbox(context.document, 'Rename file');
    for (const [name, option] of [['comments', this.comments], ['strings', this.strings], ['file', this.renameFile]]) {
      option.input.disabled = !context.options.renameCapabilities?.includes(name);
      if (option.input.disabled) option.wrapper.title = 'This option is not supported by the registered rename provider';
    }
    this.status = node(context.document, 'div', {role: 'status', 'aria-live': 'polite'});
    this.applyButton = button(context.document, 'Apply rename', () => context.safe(() => this.commit()));
    this.popup.element.append(field.wrapper, this.comments.wrapper, this.strings.wrapper, this.renameFile.wrapper,
      this.status, this.applyButton, button(context.document, 'Cancel', () => this.cancel()));
    context.lifetime.listen(this.input, 'input', () => this.schedule());
    for (const option of [this.comments, this.strings, this.renameFile]) context.lifetime.listen(option.input, 'change', () => this.schedule());
    context.lifetime.listen(this.popup.element, 'keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); context.safe(() => this.commit()); }
      if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
    });
  }

  async open() {
    const editor = this.context.editor;
    if (editor.input.readOnly || !this.context.services.supports('rename')) return;
    this.cancel(false);
    const offset = editor.offset;
    let range;
    if (this.context.services.supports('prepareRename')) {
      const result = await this.context.request('prepareRename', {offset});
      if (!result || !result.value) return;
      range = result.value;
      if (range.range) range = {...range, start: editor.sourceSnapshot().offsetAt(range.range.start),
        end: editor.sourceSnapshot().offsetAt(range.range.end)};
    } else {
      const left = editor.value.slice(0, offset).match(/[\p{L}\p{N}_]+$/u)?.[0] ?? '';
      const right = editor.value.slice(offset).match(/^[\p{L}\p{N}_]+/u)?.[0] ?? '';
      range = {start: offset - left.length, end: offset + right.length};
    }
    if (range.start === range.end) return this.context.status('No symbol to rename at the caret.');
    this.origin = {uri: editor.uri, offset, selectionEnd: editor.input.selectionEnd, range};
    this.preview = new RenamePreview(editor);
    this.input.value = range.placeholder ?? editor.value.slice(range.start, range.end);
    this.popup.show(range.start);
    this.input.focus();
    this.input.select();
    this.schedule();
  }

  schedule() {
    this.context.guard.cancel('rename');
    this.plan = null;
    this.applyButton.disabled = true;
    this.context.lifetime.delay('rename-update', () => this.context.safe(() => this.update()), 80);
  }

  async update() {
    if (!this.origin) return;
    this.preview.restore();
    const name = this.input.value;
    if (!name) { this.status.textContent = 'Enter a symbol name.'; return; }
    this.status.textContent = 'Checking rename…';
    const result = await this.context.request('rename', {offset: this.origin.offset, newName: name,
      includeComments: this.comments.input.checked, includeStrings: this.strings.input.checked, renameFile: this.renameFile.input.checked});
    if (!result || name !== this.input.value || !this.origin) return;
    this.plan = prepareWorkspaceEdit(this.context.workspace, result.value, {versions: result.versions, label: 'Rename symbol'});
    const current = this.plan.changes.find(change => change.uri === this.origin.uri);
    if (current) this.preview.show(current.edits);
    const count = this.plan.changes.reduce((sum, change) => sum + change.edits.length, 0);
    this.status.textContent = `${count} occurrences in ${this.plan.changes.length} documents`;
    this.applyButton.disabled = false;
  }

  async commit() {
    if (!this.origin || !this.plan) return;
    const plan = this.plan;
    this.preview.restore();
    this.committing = true;
    try { await commitWorkspaceEdit(this.context.workspace, plan); }
    finally { this.committing = false; }
    this.finish();
    this.context.editor.focus();
  }

  cancel(focus = true) {
    if (this.preview) {
      try { this.preview.restore(); }
      catch (error) { this.context.status(error.message); }
    }
    const origin = this.origin;
    this.finish();
    if (origin && origin.uri === this.context.editor.uri) this.context.editor.goto(origin.offset, origin.selectionEnd);
    if (focus && origin) this.context.editor.focus();
  }

  finish() {
    this.context.lifetime.cancel('rename-update');
    this.context.guard.cancel('rename');
    this.origin = null;
    this.preview = null;
    this.plan = null;
    this.popup.close();
  }

  dispose() { this.cancel(false); this.popup.dispose(); }
}
