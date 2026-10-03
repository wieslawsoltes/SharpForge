/** Native multi-select list supports keyboard range selection and activates, saves or closes the exact selected views. */
export function showWindowsDialog(windows, document) {
  const previous = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'sf-workbench-dialog-backdrop';
  const dialog = document.createElement('section');
  dialog.className = 'sf-workbench-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Windows');
  const title = document.createElement('h2');
  title.textContent = 'Windows';
  const list = document.createElement('select');
  list.multiple = true;
  list.size = 12;
  list.setAttribute('aria-label', 'Open document windows');
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const footer = document.createElement('footer');
  const close = () => { backdrop.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  const selected = () => [...list.selectedOptions].map(option => option.value);
  const actions = [];
  const updateEnabled = () => { for (const action of actions) action.disabled = !selected().length; };
  function render() {
    const selection = new Set(selected());
    list.replaceChildren();
    for (const id of windows.tabs.list()) {
      const option = document.createElement('option');
      option.value = id;
      const panel = windows.host.layout.require(id);
      option.textContent = `${panel.dirty ? '● ' : ''}${panel.description ?? panel.title} · ${windows.tabs.metadata(id).viewId}`;
      option.selected = selection.has(id) || id === windows.active;
      list.append(option);
    }
    updateEnabled();
  }
  function button(text, callback) {
    const result = document.createElement('button');
    result.type = 'button';
    result.textContent = text;
    result.onclick = async () => {
      try { await callback(); error.textContent = ''; render(); } catch (failure) { error.textContent = failure.message; }
    };
    footer.append(result);
    return result;
  }
  actions.push(button('Activate', () => {
    const id = selected()[0];
    if (id) { windows.tabs.activate(id); windows.host.focusPanel(id); close(); }
  }));
  actions.push(button('Save Selected', () => windows.tabs.saveAll(selected())));
  actions.push(button('Close Selected', () => windows.tabs.closeMany(selected())));
  button('Done', close);
  list.onchange = updateEnabled;
  list.ondblclick = () => actions[0].click();
  dialog.append(title, list, error, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);
  dialog.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('select,button:not(:disabled)')];
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
    }
  };
  render();
  list.focus();
  return { close };
}
