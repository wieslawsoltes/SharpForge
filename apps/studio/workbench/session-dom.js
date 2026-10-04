/** DOM creation uses textContent for all project/source/runtime values. */
export function element(document, tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function replaceOptions(select, entries, selected) {
  const document = select.ownerDocument;
  select.replaceChildren(...entries.map(entry => {
    const option = element(document, 'option', entry.label, { value: entry.value });
    option.selected = String(entry.value) === String(selected);
    return option;
  }));
}

export function actionButton(document, label, action, report) {
  const button = element(document, 'button', label, { type: 'button' });
  button.addEventListener('click', () => Promise.resolve().then(action).catch(report));
  return button;
}

export function selectField(document, label) {
  const wrapper = element(document, 'label', label);
  const select = element(document, 'select', null, { 'aria-label': label });
  wrapper.append(select);
  return { wrapper, select };
}
