/** Safe DOM construction for repository names, patches and provider content. */
export function gitElement(document, tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'className') element.className = value;
    else if (name === 'text') element.textContent = value;
    else if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'value') element.value = value;
    else if (name === 'checked') element.checked = value;
    else if (name === 'disabled') element.disabled = value;
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null) continue;
    element.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function gitButton(document, label, action, options = {}) {
  return gitElement(document, 'button', {
    type: 'button', text: label, title: options.title ?? label, ...options,
    onclick: event => { event.preventDefault(); action(event); }
  });
}

export function gitField(document, label, input) {
  // A select's option text must not become part of its containing label's accessible name.
  if (!input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) input.setAttribute('aria-label', label);
  return gitElement(document, 'label', { className: 'git-field' }, gitElement(document, 'span', { text: label }), input);
}

export function gitEmpty(element, title, detail) {
  const document = element.ownerDocument;
  element.replaceChildren(gitElement(document, 'section', { className: 'git-empty' },
    gitElement(document, 'h3', { text: title }), gitElement(document, 'p', { text: detail })));
}

/** A keyboard accessible dialog with focus restoration and browser-native validation. */
export function gitDialog(document, { title, fields, submitLabel = 'Continue', onSubmit, onCancel }) {
  const previous = document.activeElement;
  const dialog = gitElement(document, 'dialog', { className: 'git-dialog', 'aria-label': title });
  const form = gitElement(document, 'form');
  const status = gitElement(document, 'p', { role: 'alert', className: 'git-error' });
  const controls = {};
  form.append(gitElement(document, 'h2', { text: title }));
  for (const field of fields) {
    const input = field.options ? gitElement(document, 'select', { name: field.name },
      field.options.map(option => gitElement(document, 'option', { value: option.value, text: option.label })))
      : gitElement(document, field.multiline ? 'textarea' : 'input', {
        name: field.name, type: field.type ?? 'text', value: field.value ?? '', required: field.required,
        checked: field.checked, min: field.min, max: field.max, step: field.step, placeholder: field.placeholder,
        autocomplete: field.type === 'password' ? 'off' : undefined, rows: field.multiline ? 4 : undefined
      });
    if (field.value !== undefined) input.value = field.value;
    controls[field.name] = input;
    form.append(gitField(document, field.label, input));
  }
  const submit = gitElement(document, 'button', { type: 'submit', text: submitLabel, className: 'git-primary' });
  let controller;
  const cancel = () => { controller?.abort(); onCancel?.(); };
  form.append(status, gitElement(document, 'footer', {}, gitButton(document, 'Cancel', () => { cancel(); dialog.close(); }), submit));
  dialog.addEventListener('cancel', cancel);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    controller = new AbortController();
    try {
      const values = Object.fromEntries(Object.entries(controls).map(([key, input]) =>
        [key, input.type === 'checkbox' ? input.checked : input.value]));
      await onSubmit(values, { signal: controller.signal, progress: message => { status.textContent = message; } });
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { controller = null; submit.disabled = false; }
  });
  dialog.append(form);
  dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  form.querySelector('input,select,textarea')?.focus();
  return dialog;
}
