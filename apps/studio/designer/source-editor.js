import { designSourceFormat } from '../../../packages/designer/src/index.js';

function openXamlEditor(view, uri, offset = 0) {
  const file = view.sourceSync.files().find(item => item.uri === uri);
  if (!file) throw new Error('XAML source is unavailable');
  const document = view.panel('designer').ownerDocument;
  const dialog = document.createElement('dialog');
  const title = document.createElement('h2');
  title.textContent = uri;
  const editor = document.createElement('textarea');
  editor.className = 'explorer-text';
  editor.setAttribute('aria-label', 'XAML source editor');
  editor.value = file.text;
  editor.spellcheck = false;
  editor.rows = 24;
  editor.cols = 100;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const save = document.createElement('button');
  save.textContent = 'Apply XAML';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  dialog.append(title, editor, status, save, cancel);
  dialog.setAttribute('aria-label', 'Edit ' + uri);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  cancel.onclick = () => dialog.close();
  save.onclick = async () => {
    save.disabled = true;
    try {
      await view.sourceSync.editText(editor.value, { uri, expectedVersion: file.version, expectedText: file.text });
      dialog.close();
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  };
  dialog.showModal();
  editor.focus();
  editor.setSelectionRange(offset, offset);
}

const editors = Object.freeze({ csharp: (view, uri, offset) => view.openSource(uri, offset), xaml: openXamlEditor });

export function openDesignerSource(view, uri, offset) {
  return editors[designSourceFormat(uri).id](view, uri, offset);
}

export function appendDesignSourceLocation(root, view, analysis, node) {
  const binding = analysis?.bindings[node.id];
  if (!binding) return;
  const button = root.ownerDocument.createElement('button');
  button.textContent = 'Go to ' + designSourceFormat(analysis.uri).label;
  button.title = 'Navigate to the selected control declaration';
  button.dataset.designGotoSource = '';
  button.onclick = () => openDesignerSource(view, analysis.uri,
    binding.element?.start ?? binding.declaration?.start ?? binding.statement?.start ?? analysis.method.start);
  root.append(button);
}
