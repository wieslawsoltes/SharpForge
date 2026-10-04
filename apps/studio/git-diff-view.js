import { CodeEditor } from '@sharpforge/editor';
import { gitElement, gitButton } from './git-dom.js';

/** The source panes own editor instances and models; no workspace buffer is passed to them. */
export function createReadOnlySourceInspector(document, workbench, { signal, onError } = {}) {
  const content = gitElement(document, 'div', { className: 'git-source-sides' });
  const element = gitElement(document, 'details', { className: 'git-source-inspector' },
    gitElement(document, 'summary', { text: 'Read-only source versions' }), content);
  let comparison = null;
  let position = 0;
  let epoch = 0;
  let editors = [];
  let disposed = false;

  const clear = () => { for (const editor of editors) editor.dispose(); editors = []; };
  const load = async () => {
    if (!element.open || !comparison || comparison.binary || disposed) return;
    const request = ++epoch;
    const sources = await workbench.request('comparisonDocuments', {
      cacheKey: comparison.cacheKey, start: Math.max(0, position - 64), count: 256
    }, { signal });
    if (disposed || signal?.aborted || request !== epoch) return;
    clear();
    content.replaceChildren();
    for (const [side, source] of Object.entries(sources)) {
      const label = `${side === 'before' ? 'Before' : 'After'} · ${source.oid?.slice(0, 8) ?? (source.exists ? 'Worktree' : 'Absent')}`;
      const model = gitElement(document, 'div', { className: 'git-source-editor' });
      const heading = source.excerpt ? `${label} · context from line ${source.startLine}` : label;
      content.append(gitElement(document, 'section', {}, gitElement(document, 'h4', { text: heading }), model));
      const editor = new CodeEditor(model);
      editor.setModel(`git:${source.oid ?? side}:${source.path}:line${source.startLine}`, source.text);
      editor.setReadOnly(true);
      editor.input.setAttribute('aria-label', `Read-only ${side} source`);
      editor.gutter.setAttribute('aria-label', `${side} source line numbers`);
      editors.push(editor);
    }
  };
  const refresh = () => { load().catch(error => { if (!disposed && !signal?.aborted) onError?.(error); }); };
  element.addEventListener('toggle', refresh);
  return {
    element,
    setComparison(value) { comparison = value; element.hidden = !value || value.binary; refresh(); },
    select(index) { position = index; refresh(); },
    dispose() { disposed = true; epoch++; clear(); element.removeEventListener('toggle', refresh); }
  };
}

/** Hunk actions are attached to their first changed row, keeping one fixed-height row per diff operation. */
export function createHunkGutter(document, { edit, historical, staged, stage, revert }) {
  const gutter = gitElement(document, 'span', { className: 'git-hunk-actions' });
  if (!edit.hunk || historical) return gutter;
  const line = edit.type === 'delete' ? edit.oldLine : edit.newLine;
  gutter.append(gitButton(document, staged ? '−' : '+', () => stage(edit.hunk), {
    'aria-label': `${staged ? 'Unstage' : 'Stage'} hunk at line ${line}`,
    title: `${staged ? 'Unstage' : 'Stage'} hunk`, className: 'git-hunk-button'
  }));
  if (!staged) gutter.append(gitButton(document, '↶', () => revert(edit.hunk), {
    'aria-label': `Revert hunk at line ${line}`, title: 'Revert hunk', className: 'git-hunk-button'
  }));
  return gutter;
}
