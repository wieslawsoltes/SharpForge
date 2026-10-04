/** Displays an accessible per-document Save / Do Not Save / Cancel prompt. Escape cancels the whole batch. */
export function confirmDirtyDocuments(document, items, { signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return; }
    const previous = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'sf-workbench-dialog-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'sf-workbench-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Save modified documents');
    const title = document.createElement('h2');
    title.textContent = 'Save modified documents';
    const intro = document.createElement('p');
    intro.textContent = 'Choose what to do with each modified document before closing.';
    const selections = new Map();
    dialog.append(title, intro);
    for (const item of items) {
      const label = document.createElement('label');
      label.className = 'sf-workbench-dialog-row';
      const caption = document.createElement('span');
      caption.textContent = item.uri;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Close choice for ${item.uri}`);
      for (const [value, text] of [['save', 'Save'], ['discard', 'Do Not Save']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      label.append(caption, select);
      dialog.append(label);
      selections.set(item.uri, select);
    }
    const footer = document.createElement('footer');
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      backdrop.remove();
      signal?.removeEventListener('abort', abort);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(value);
    }
    function abort() { finish(null); }
    function button(text, action) {
      const result = document.createElement('button');
      result.type = 'button';
      result.textContent = text;
      result.onclick = action;
      return result;
    }
    footer.append(button('Save All', () => finish('save')), button('Do Not Save All', () => finish('discard')),
      button('Cancel', () => finish(null)),
      button('Apply Choices', () => finish(Object.fromEntries([...selections].map(([uri, select]) => [uri, select.value])))));
    dialog.append(footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
    dialog.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); finish(null); }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,select')];
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    dialog.querySelector('select,button')?.focus();
  });
}
