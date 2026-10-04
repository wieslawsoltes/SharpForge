/** Bounded assistive buffer, independent of the viewport; focus remains on the native text input. */
export class EditorAccessibility {
  constructor(editor) {
    this.editor = editor;
    const document = editor.element.ownerDocument;
    let index = 1;
    while (document.getElementById(`sf-editor-${index}-status`)) index++;
    const prefix = `sf-editor-${index}`;
    this.status = document.createElement('div');
    this.status.id = `${prefix}-status`;
    this.status.className = 'sf-screen-reader';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');
    this.buffer = document.createElement('div');
    this.buffer.id = `${prefix}-buffer`;
    this.buffer.className = 'sf-screen-reader';
    this.buffer.setAttribute('aria-label', 'Source around cursor');
    editor.element.append(this.status, this.buffer);
    editor.input.setAttribute('aria-describedby', this.buffer.id);
    editor.input.setAttribute('aria-keyshortcuts', 'Escape F8 Shift+F8 Control+Space');
    this.lastPosition = '';
    this.lastAnnouncement = '';
  }

  update() {
    const {editor} = this;
    const position = editor.model.positionAt(editor.caretOffset);
    const key = `${editor.model.version}:${position.line}:${position.character}:${editor.input.selectionEnd}`;
    if (this.lastPosition === key) return;
    this.lastPosition = key;
    const radius = Math.min(5, Math.max(0, editor.options.screenReaderWindowLines));
    const first = Math.max(0, position.line - radius);
    const last = Math.min(editor.model.lineCount - 1, position.line + radius);
    const lines = [];
    for (let line = first; line <= last; line++) {
      const start = editor.model.getLineStart(line);
      const end = Math.min(editor.model.getLineEnd(line), start + 1000);
      lines.push(`${line + 1}: ${editor.model.getText(start, end)}`);
    }
    this.buffer.textContent = lines.join('\n');
    const selected = editor.input.selectionEnd - editor.input.selectionStart;
    const description = `${editor.uri || 'Untitled'}, line ${position.line + 1} of ${editor.model.lineCount}, column ${position.character + 1}`;
    editor.input.setAttribute('aria-label', `${description}${selected ? `, ${selected} characters selected` : ''}`);
    editor.input.setAttribute('aria-readonly', String(editor.input.readOnly));
  }

  announce(message, key = null) {
    if (!message || this.editor.disposed) return;
    if (key && key === this.lastAnnouncement) return;
    this.lastAnnouncement = key ?? '';
    this.status.textContent = '';
    this.status.textContent = String(message);
  }

  activeDescendant(element) {
    if (element?.id) this.editor.input.setAttribute('aria-activedescendant', element.id);
    else this.editor.input.removeAttribute('aria-activedescendant');
  }

  dispose() { this.status.remove(); this.buffer.remove(); }
}
