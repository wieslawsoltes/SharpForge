function mountDialog(document, titleText) {
  const previous = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'sf-workbench-dialog-backdrop';
  const dialog = document.createElement('section');
  dialog.className = 'sf-workbench-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', titleText);
  const title = document.createElement('h2');
  title.textContent = titleText;
  dialog.append(title);
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => { backdrop.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  dialog.onkeydown = event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled),input,select')];
    const index = controls.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
  };
  return { dialog, close };
}

export function promptLayoutName(document, value = '') {
  return new Promise(resolve => {
    const { dialog, close } = mountDialog(document, 'Save Window Layout');
    const input = document.createElement('input');
    input.value = value;
    input.maxLength = 100;
    input.setAttribute('aria-label', 'Layout name');
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    const finish = result => { close(); resolve(result); };
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.onclick = () => {
      if (!input.value.trim()) { error.textContent = 'Enter a layout name.'; return; }
      finish(input.value.trim());
    };
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.onclick = () => finish(null);
    dialog.append(input, error, cancel, save);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter') save.click();
    });
    input.focus();
  });
}

export function showLayoutDialog(layouts, document) {
  const { dialog, close } = mountDialog(document, 'Manage Window Layouts');
  const list = document.createElement('select');
  list.size = 8;
  list.setAttribute('aria-label', 'Saved window layouts');
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const render = () => {
    const selected = list.value;
    list.replaceChildren();
    layouts.names().forEach((name, index) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = `${index < 9 ? `Ctrl+Alt+${index + 1} · ` : ''}${name}`;
      list.append(option);
    });
    if (layouts.names().includes(selected)) list.value = selected;
  };
  function button(text, action) {
    const result = document.createElement('button');
    result.textContent = text;
    result.onclick = async () => {
      try { await action(); error.textContent = ''; render(); } catch (failure) { error.textContent = failure.message; }
    };
    return result;
  }
  const footer = document.createElement('footer');
  footer.append(button('Apply', () => { if (list.value) layouts.apply(list.value); }),
    button('Rename', async () => {
      if (!list.value) return;
      const name = await promptLayoutName(document, list.value);
      if (name !== null) layouts.rename(list.value, name);
    }), button('Delete', () => { if (list.value) layouts.remove(list.value); }), button('Close', close));
  dialog.append(list, error, footer);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  render();
  list.focus();
  return { close };
}
