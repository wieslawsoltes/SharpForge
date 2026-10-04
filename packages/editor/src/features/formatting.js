import {prepareWorkspaceEdit, commitWorkspaceEdit} from '../services/workspace-edit.js';

export class EditorFormatting {
  constructor(context) {
    this.context = context;
    this.applying = false;
  }

  async format(options = {}) {
    const editor = this.context.editor;
    if (editor.input.readOnly || this.applying) return;
    const supported = method => this.context.services.supports(method);
    const method = options.character && supported('formatOnType') ? 'formatOnType' :
      options.range && supported('formatRange') ? 'formatRange' : supported('format') ? 'format' : null;
    if (!method) return;
    const source = editor.sourceSnapshot();
    const range = options.range;
    const result = await this.context.request(method, {offset: editor.offset, character: options.character,
      start: range?.start, end: range?.end, range: range ? {start: source.positionAt(range.start), end: source.positionAt(range.end)} : undefined,
      options: {tabSize: this.context.options.tabSize ?? 4, insertSpaces: this.context.options.insertSpaces !== false}}, {key: 'formatting'});
    if (!result?.value) return;
    const value = Array.isArray(result.value) ? result.value.map(edit => ({uri: result.revision.uri, ...edit})) : result.value;
    const plan = prepareWorkspaceEdit(this.context.workspace, value, {versions: result.versions, label: 'Format code'});
    if (!plan.changes.length) return;
    this.applying = true;
    try { await commitWorkspaceEdit(this.context.workspace, plan); }
    finally { this.applying = false; }
  }

  beforeinput(event) {
    if (event.inputType === 'insertFromPaste') this.pendingPaste = {start: this.context.editor.offset,
      end: this.context.editor.input.selectionEnd, text: event.data ?? event.dataTransfer?.getData('text/plain') ?? ''};
  }

  changed(change) {
    if (this.applying || String(change?.source ?? '').startsWith('format')) return;
    if (this.pendingPaste && this.context.options.formatOnPaste !== false) {
      const paste = this.pendingPaste;
      this.pendingPaste = null;
      this.schedule({range: {start: paste.start, end: paste.start + paste.text.length}});
      return;
    }
    if (this.context.options.formatOnType === false) return;
    const edit = (change?.changes ?? change?.edits)?.at(-1);
    const text = edit?.text ?? edit?.insertText ?? edit?.newText;
    if (text !== ';' && text !== '}') return;
    const editor = this.context.editor;
    const source = editor.sourceSnapshot();
    const line = source.positionAt(editor.offset).line;
    const start = text === '}' ? editor.pairs?.get(editor.offset - 1) ?? source.lineStarts[line] : source.lineStarts[line];
    this.schedule({character: text, range: {start, end: editor.offset}});
  }

  afterCompletion() {
    if (this.context.options.formatOnCompletion === false) return;
    const editor = this.context.editor;
    const source = editor.sourceSnapshot();
    const line = source.positionAt(editor.offset).line;
    this.schedule({range: {start: source.lineStarts[line], end: source.lineStarts[line + 1] ?? source.length}});
  }

  schedule(options) {
    this.context.lifetime.delay('formatting', () => this.context.safe(() => this.format(options)), 30);
  }
}
