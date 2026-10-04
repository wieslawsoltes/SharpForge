import {accessibleWidget} from '../a11y/widgets.js';

export class GoToLineWidget {
  constructor(editor) {
    this.editor = editor;
    const document = editor.element.ownerDocument;
    this.element = document.createElement('div');
    this.element.className = 'sf-goto';
    this.element.hidden = true;
    const label = document.createElement('label');
    label.textContent = 'Go to line ';
    this.input = document.createElement('input');
    this.input.setAttribute('aria-label', 'Go to line');
    this.input.placeholder = 'line:column';
    this.input.inputMode = 'numeric';
    this.status = document.createElement('span');
    this.status.setAttribute('role', 'status');
    label.append(this.input);
    this.element.append(label, this.status);
    editor.element.append(this.element);
    this.disposeA11y = accessibleWidget(this.element, {label: 'Go to line', editor, close: () => this.close()});
    this.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const match = /^(\d+)(?::(\d+))?$/.exec(this.input.value.trim());
      if (!match || Number(match[1]) < 1 || Number(match[1]) > editor.model.lineCount || match[2] && Number(match[2]) < 1) {
        this.status.textContent = 'Enter a valid line and optional column';
        return;
      }
      this.close();
      editor.gotoLine(Number(match[1]), Number(match[2] ?? 1));
    });
  }
  open() {
    this.element.hidden = false;
    this.input.value = String(this.editor.model.positionAt(this.editor.offset).line + 1);
    this.input.focus();
    this.input.select();
  }
  close() { this.element.hidden = true; this.editor.focus(); }
  dispose() { this.disposeA11y(); this.element.remove(); }
}
