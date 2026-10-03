/** Embeddable per-language text options page, scoped to the supplied editor/settings owner. */
export function createEditorOptionsPage(editor) {
  const document = editor.element.ownerDocument;
  const form = document.createElement('form');
  form.className = 'sf-editor-options';
  form.setAttribute('aria-label', 'Text editor options');
  const title = document.createElement('h3');
  title.textContent = `Text editor · ${editor.options.language}`;
  form.append(title);
  const fields = [
    ['insertSpaces', 'Insert spaces', 'checkbox'], ['indentSize', 'Indent size', 'number'], ['tabSize', 'Tab width', 'number'],
    ['wordWrap', 'Word wrap', 'checkbox'], ['renderWhitespace', 'Show whitespace', 'checkbox'],
    ['trimTrailingWhitespace', 'Trim trailing whitespace on save', 'checkbox'],
    ['insertFinalNewline', 'Insert final newline on save', 'checkbox'], ['virtualSpace', 'Virtual space', 'checkbox']
  ];
  for (const [name, text, type] of fields) {
    const label = document.createElement('label');
    label.textContent = text;
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    if (type === 'checkbox') input.checked = !!editor.options[name];
    else { input.min = '1'; input.max = '32'; input.value = String(editor.options[name]); }
    label.append(input);
    form.append(label);
  }
  const ending = document.createElement('select');
  ending.name = 'endOfLine';
  ending.setAttribute('aria-label', 'Line endings');
  for (const [label, value] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']]) {
    const option = document.createElement('option');
    option.textContent = label;
    option.value = value;
    option.selected = editor.options.endOfLine === value;
    ending.append(option);
  }
  form.append(ending);
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.textContent = 'Apply';
  form.append(apply);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const changes = {endOfLine: ending.value};
    for (const [name, , type] of fields) {
      const input = form.elements.namedItem(name);
      changes[name] = type === 'checkbox' ? input.checked : Number(input.value);
    }
    editor.updateOptions(changes);
    editor.accessibility.announce('Editor options applied');
  });
  return form;
}
