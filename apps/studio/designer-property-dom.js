import {DesignerAuthoringError} from '../../packages/designer/src/index.js';

/** Small DOM factories keep each editor independent and text safe by construction. */
export function propertyElement(document, tag, text = '', className = '') {
  const element = document.createElement(tag);
  if (text !== '') element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function propertyButton(document, label, action, {title = label, disabled = false} = {}) {
  const button = propertyElement(document, 'button', label);
  button.type = 'button';
  button.title = title;
  button.disabled = disabled;
  button.addEventListener('click', action);
  return button;
}

export function propertyField(document, label, input) {
  const field = propertyElement(document, 'label', '', 'design-editor-field');
  field.append(propertyElement(document, 'span', label), input);
  input.setAttribute('aria-label', label);
  return field;
}

export function propertyInput(document, {value = '', type = 'text', placeholder = '', label = ''} = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  if (label) input.setAttribute('aria-label', label);
  return input;
}

export function propertySelect(document, choices, selected, label) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = String(choice.value ?? choice);
    option.textContent = choice.label ?? String(choice);
    select.append(option);
  }
  select.value = selected === undefined ? String(choices[0]?.value ?? choices[0] ?? '') : String(selected);
  return select;
}

export function parseDesignerPropertyText(text, type) {
  if (type !== 'bool') return text;
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw new DesignerAuthoringError('SFD1844', 'Boolean values must be true or false.');
}

export function showPropertyError(element, error) {
  element.textContent = error?.diagnostic?.message ?? error?.message ?? String(error);
  element.hidden = false;
  element.setAttribute('role', 'alert');
}

export async function runPropertyAction(action, error) {
  try {
    error.hidden = true;
    return await action();
  } catch (failure) {
    showPropertyError(error, failure);
    return undefined;
  }
}

/** Modal disposal returns focus and ensures cancellation never commits the isolated draft. */
export function propertyDialog(document, title, {onCancel = () => {}} = {}) {
  const previousFocus = document.activeElement;
  const dialog = propertyElement(document, 'dialog', '', 'design-authoring-dialog');
  dialog.setAttribute('aria-label', title);
  const heading = propertyElement(document, 'h3', title);
  const body = propertyElement(document, 'div', '', 'design-authoring-dialog-body');
  const error = propertyElement(document, 'p', '', 'design-editor-error');
  error.hidden = true;
  const footer = propertyElement(document, 'div', '', 'design-authoring-dialog-actions');
  let closed = false;
  const close = (cancel = false) => {
    if (closed) return;
    closed = true;
    if (cancel) onCancel();
    dialog.close?.();
    dialog.remove();
    previousFocus?.focus?.();
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
  footer.append(propertyButton(document, 'Cancel', () => close(true)));
  dialog.append(heading, body, error, footer);
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return {dialog, body, footer, error, close, run: action => runPropertyAction(action, error)};
}
