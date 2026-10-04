/** Accessible command-line prompt; Escape restores focus without changing the source buffer. */
export function openKeymapPrompt(editor, { prefix = ':', value = '', onSubmit, onCancel = () => {} }) {
  const document = editor.element?.ownerDocument;
  if (!document) throw new Error('This keymap command requires an interactive prompt provider');
  const previous = document.activeElement;
  const form = document.createElement('form');
  form.className = 'sf-keymap-prompt';
  form.setAttribute('aria-label', prefix === ':' ? 'Vim command' : 'Vim search');
  const label = document.createElement('label');
  label.textContent = prefix;
  const input = document.createElement('input');
  input.value = value;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', prefix === ':' ? 'Vim command' : 'Search pattern');
  label.append(input);
  form.append(label);
  editor.element.append(form);
  let disposed = false;
  const close = () => {
    if (disposed) return;
    disposed = true;
    form.remove();
    if (previous?.isConnected) previous.focus();
    else editor.input.focus();
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value;
    close();
    Promise.resolve(onSubmit(value)).catch(error => editor.onKeymapState?.({ keymap: 'vim', mode: error.message }));
  });
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); onCancel(); }
  });
  input.focus();
  return close;
}
