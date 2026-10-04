/** Two independently selected/scrolled views share one EditorModel and one undo stack. */
export class EditorSplit {
  constructor(editor) { this.editor = editor; this.second = null; }
  toggle() { if (this.second) this.remove(); else this.create(); }
  create() {
    if (this.second) return this.second;
    const {editor} = this;
    const document = editor.element.ownerDocument;
    this.host = document.createElement('div');
    this.host.className = 'sf-editor-split-host';
    this.divider = document.createElement('div');
    this.divider.className = 'sf-editor-splitter';
    this.divider.tabIndex = 0;
    this.divider.setAttribute('role', 'separator');
    this.divider.setAttribute('aria-label', 'Resize editor split');
    this.divider.setAttribute('aria-orientation', 'horizontal');
    this.divider.setAttribute('aria-valuemin', '15');
    this.divider.setAttribute('aria-valuemax', '85');
    this.divider.setAttribute('aria-valuenow', '50');
    editor.element.append(this.divider, this.host);
    editor.element.classList.add('sf-has-split');
    this.second = new editor.constructor(this.host, {
      ...editor.callbacks, request: editor.request, keymap: editor.keymap, model: editor.model,
      session: editor.session, options: editor.options, services: editor.services, splitChild: true
    });
    this.second.setSelections(editor.getSelections());
    this.second.view.scrollTo({top: editor.view.scrollTop});
    const resize = percent => {
      const value = Math.max(15, Math.min(85, percent));
      editor.element.style.setProperty('--sf-split-position', `${value}%`);
      this.divider.setAttribute('aria-valuenow', String(Math.round(value)));
      editor.sync();
      this.second.sync();
    };
    this.divider.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      resize(Number(this.divider.getAttribute('aria-valuenow')) + (event.key === 'ArrowDown' ? 5 : -5));
    });
    this.divider.addEventListener('pointerdown', event => {
      event.preventDefault();
      this.divider.setPointerCapture(event.pointerId);
      const move = pointer => {
        const rect = editor.element.getBoundingClientRect();
        resize((pointer.clientY - rect.top) / rect.height * 100);
      };
      this.divider.addEventListener('pointermove', move);
      this.divider.addEventListener('pointerup', () => this.divider.removeEventListener('pointermove', move), {once: true});
    });
    return this.second;
  }
  remove() {
    if (!this.second) return;
    const focused = this.host.contains(this.host.ownerDocument.activeElement);
    if (focused) {
      this.editor.setSelections(this.second.getSelections());
      this.editor.view.scrollTo({top: this.second.view.scrollTop, left: this.second.view.viewport.scrollLeft});
    }
    this.second.dispose();
    this.second = null;
    this.divider.remove();
    this.host.remove();
    this.editor.element.classList.remove('sf-has-split');
    this.editor.sync();
    if (focused) this.editor.focus();
  }
  dispose() { this.remove(); }
}
