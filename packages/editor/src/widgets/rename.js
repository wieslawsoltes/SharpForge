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
    for (const [name, option] of [['comments', this.comments], ['strings', this.strings], ['file', this.renameFile]]) {
      const provided = range.capabilities ?? this.context.options.renameCapabilities ?? [];
      const enabled = provided.includes(name) && (name !== 'file' || this.context.workspace.supportsResourceRename === true);
      option.input.disabled = !enabled;
      option.input.checked = false;
      option.wrapper.title = enabled ? '' : 'This option is unavailable for the current source and workspace';
    }
    this.origin = {uri: editor.uri, model: editor.model, offset, selectionEnd: editor.input.selectionEnd, range};
    this.preview = new RenamePreview(editor);
    this.resumeRequests = this.context.suspendRequests(['rename']);
    this.input.value = range.placeholder ?? editor.value.slice(range.start, range.end);
    this.popup.show(range.start);
    this.input.focus();
    this.input.select();
    this.schedule();
  }

  schedule() {
    if (this.committing) return;
    this.context.guard.cancel('rename');
    this.plan = null;
    this.applyButton.disabled = true;
    this.context.lifetime.delay('rename-update', () => this.context.safe(() => this.update()), 80);
  }

  async update() {
    if (!this.origin || this.committing) return;
    if (!this.current()) return this.cancel(false);
    const origin = this.origin;
    this.preview.restore();
    const name = this.input.value;
    if (!name) { this.status.textContent = 'Enter a symbol name.'; return; }
    this.status.textContent = 'Checking rename…';
    const result = await this.context.request('rename', {offset: this.origin.offset, newName: name,
      includeComments: this.comments.input.checked, includeStrings: this.strings.input.checked, renameFile: this.renameFile.input.checked});
    if (!result || name !== this.input.value || this.origin !== origin) return;
    if (!this.current()) return this.cancel(false);
    this.plan = prepareWorkspaceEdit(this.context.workspace, result.value, {versions: result.versions, label: 'Rename symbol'});
    const current = this.plan.changes.find(change => change.uri === this.origin.uri);
    if (current) this.preview.show(current.edits);
    const count = this.plan.changes.reduce((sum, change) => sum + change.edits.length, 0);
    const resources = this.plan.resources ?? [];
    this.status.textContent = `${count} occurrences in ${this.plan.changes.length} documents` +
      (resources.length ? `; rename ${resources.map(resource => `${resource.oldUri} → ${resource.newUri}`).join(', ')}` : '');
    this.applyButton.disabled = false;
  }

  async commit() {
    if (!this.origin || !this.plan || this.committing) return;
    if (!this.current()) return this.cancel(false);
    const plan = this.plan;
    const origin = this.origin;
    const controller = new AbortController();
    this.commitController = controller;
    this.committing = true;
    this.applyButton.disabled = true;
    this.input.disabled = true;
    for (const option of [this.comments, this.strings, this.renameFile]) option.input.disabled = true;
    this.status.textContent = 'Applying rename…';
    try {
      this.preview.release();
      await commitWorkspaceEdit(this.context.workspace, plan, {signal: controller.signal});
    }
    finally {
      if (this.commitController === controller) {
        this.commitController = null;
        this.committing = false;
      }
      if (this.origin === origin) {
        this.finish();
        if (!this.context.editor.disposed) this.context.editor.focus();
      }
    }
  }

  cancel(focus = true) {
    this.commitController?.abort();
    this.commitController = null;
    this.committing = false;
    if (this.preview) {
      try { this.preview.release(); }
      catch (error) { this.context.status(error.message); }
    }
    const origin = this.origin;
    this.finish();
    if (origin && origin.uri === this.context.editor.uri && origin.model === this.context.editor.model) {
      this.context.editor.goto(origin.offset, origin.selectionEnd);
    }
    if (focus && origin) this.context.editor.focus();
  }

  current() {
    if (!this.origin || this.context.editor.disposed) return false;
    const editor = this.context.editor;
    if (editor.uri !== this.origin.uri || editor.model !== this.origin.model) return false;
    if (typeof this.context.workspace.getDocument !== 'function') return true;
    const document = this.context.workspace.getDocument(this.origin.uri);
    return !!document && (!document.model || document.model === this.origin.model);
  }

  changed() { if (this.origin && !this.committing && !this.current()) this.cancel(false); }

  finish() {
    this.context.lifetime.cancel('rename-update');
    this.context.guard.cancel('rename');
    this.origin = null;
    this.preview = null;
    this.plan = null;
    this.input.disabled = false;
    this.resumeRequests?.();
    this.resumeRequests = null;
    this.popup.close();
  }

  dispose() { this.cancel(false); this.popup.dispose(); }
}
