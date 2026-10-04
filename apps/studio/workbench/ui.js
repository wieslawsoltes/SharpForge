/** DOM helpers keep untrusted source and diagnostics in text nodes. */
export function element(document, tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (name === 'text') node.textContent = String(value);
    else if (name === 'className') node.className = value;
    else if (name === 'value') node.value = value;
    else if (name === 'checked' || name === 'disabled' || name === 'hidden') node[name] = Boolean(value);
    else node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

export function button(document, label, action, attributes = {}) {
  const node = element(document, 'button', {type: 'button', text: label, ...attributes});
  node.addEventListener('click', action);
  return node;
}

export function field(document, label, control) {
  return element(document, 'label', {className: 'wb-field'}, [element(document, 'span', {text: label}), control]);
}

export function select(document, label, options, value, change) {
  const node = element(document, 'select', {'aria-label': label});
  for (const option of options) {
    const entry = typeof option === 'string' ? {value: option, label: option} : option;
    node.append(element(document, 'option', {value: entry.value, text: entry.label}));
  }
  node.value = value;
  node.addEventListener('change', () => change(node.value));
  return node;
}

export function checkbox(document, label, checked, change) {
  const input = element(document, 'input', {type: 'checkbox', checked});
  input.addEventListener('change', () => change(input.checked));
  return element(document, 'label', {className: 'wb-checkbox'}, [input, document.createTextNode(label)]);
}

export function reportError(host, error) {
  host.replaceChildren(element(host.ownerDocument, 'p', {className: 'wb-error', role: 'alert', text: error.message ?? error}));
}

export function runAction(action, onError) {
  return (...args) => Promise.resolve().then(() => action(...args)).catch(onError);
}

export function copyText(text, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard?.writeText) throw new Error('Clipboard writing is unavailable in this browser context');
  return clipboard.writeText(String(text));
}

export function input(document, label, value = '', change = () => {}, attributes = {}) {
  const node = element(document, 'input', {'aria-label': label, value, ...attributes});
  node.addEventListener('input', () => change(node.value));
  return node;
}
