export class EditorZoom {
  constructor(editor) {
    this.editor = editor;
    const document = editor.element.ownerDocument;
    this.control = document.createElement('select');
    this.control.className = 'sf-editor-zoom';
    this.control.setAttribute('aria-label', 'Editor zoom');
    for (const value of [20, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}%`;
      this.control.append(option);
    }
    this.control.addEventListener('change', () => editor.setZoom(Number(this.control.value)));
    editor.element.append(this.control);
  }
  update() {
    const value = String(this.editor.options.zoom);
    if (!Array.from(this.control.options).some(option => option.value === value)) {
      const option = this.control.ownerDocument.createElement('option');
      option.value = value;
      option.textContent = `${value}%`;
      this.control.append(option);
    }
    this.control.value = value;
  }
  dispose() { this.control.remove(); }
}
