import { gitElement } from './git-dom.js';
import { gitEditorView, gitEditorVisibleLines, subscribeGitEditorView } from './git-editor-geometry.js';

/** Virtual attribution beside the existing editor; never changes its model or tokenization. */
export async function createGitBlameMargin(workbench, editor) {
  if (!editor?.input || editor.element.classList.contains('sf-classic-active')) {
    throw new Error('The blame margin requires the standard source editor. File blame remains available in Git Diff.');
  }
  const uri = editor.uri;
  const repositoryId = workbench.repositoryId;
  const workspace = workbench.host.getWorkspaceIdentity();
  const document = editor.element.ownerDocument;
  const view = gitEditorView(editor);
  const previousGutterWidth = editor.element.style.getPropertyValue('--git-editor-gutter-width');
  if (view) {
    const width = view.viewport.getBoundingClientRect().left - editor.element.getBoundingClientRect().left;
    editor.element.style.setProperty('--git-editor-gutter-width', `${Math.max(0, width)}px`);
  }
  const element = gitElement(document, 'aside', { className: 'git-blame-margin', 'aria-label': 'Git blame margin' });
  const rows = gitElement(document, 'div', { className: 'git-blame-margin-rows' });
  const status = gitElement(document, 'span', { className: 'git-blame-margin-status', role: 'status' });
  element.append(rows, status);
  editor.element.append(element);
  editor.element.classList.add('git-with-blame');
  view?.schedule();
  const pages = new Map();
  let revision = 'HEAD';
  let workingOid;
  let total = Infinity;
  let generation = 0;
  let controller;
  let activeStart;
  let timer;
  let disposed = false;

  const current = () => !disposed && !editor.disposed && editor.uri === uri && repositoryId === workbench.repositoryId &&
    workspace === workbench.host.getWorkspaceIdentity();
  function draw() {
    if (!current()) { dispose(); return; }
    const visible = gitEditorVisibleLines(editor, total);
    const nodes = [];
    for (const { index, top, height } of visible) {
      const item = pages.get(Math.floor(index / 128) * 128)?.[index % 128];
      if (!item) continue;
      const author = item.author?.name ?? 'Uncommitted';
      const committed = item.oid && !item.uncommitted && !/^0+$/.test(item.oid);
      const node = gitElement(document, 'button', { type: 'button', className: 'git-blame-margin-row', 'data-line': String(index),
        title: committed ? `${author}: ${item.summary ?? ''}\n${item.oid}` : 'This line is not committed',
        text: `${item.oid?.slice(0, 7) ?? '0000000'} ${author}`,
        onclick: () => {
          if (!committed) return;
          workbench.historyPath = item.path ?? uri;
          workbench.historyRevision = item.oid;
          workbench.host.showPanel('git-repository');
        } });
      node.style.top = `${top}px`;
      node.style.height = `${height}px`;
      nodes.push(node);
    }
    rows.replaceChildren(...nodes);
    const missing = visible.map(row => Math.floor(row.index / 128) * 128).find(start => !pages.has(start));
    if (missing !== undefined && activeStart !== missing) void load(missing);
  }
  async function load(start) {
    controller?.abort();
    controller = new AbortController();
    const requestGeneration = ++generation;
    activeStart = start;
    status.textContent = 'Loading blame…';
    try {
      const result = await workbench.request('blamePage', { repositoryId, path: uri, revision,
        workingTree: true, workingOid, start, count: 128 }, { signal: controller.signal });
      if (!current() || generation !== requestGeneration) return;
      revision = result.revision;
      workingOid = result.workingOid;
      total = result.total;
      pages.set(result.start, result.lines);
      const visiblePages = new Set(gitEditorVisibleLines(editor, total).map(row => Math.floor(row.index / 128) * 128));
      // Folding can expose distant logical lines; retain their pages without cycling requests. At most 160 rows are visible.
      for (const key of pages.keys()) {
        if (pages.size <= Math.max(32, visiblePages.size)) break;
        if (!visiblePages.has(key)) pages.delete(key);
      }
      status.textContent = '';
      activeStart = undefined;
      draw();
    } catch (error) {
      if (current() && generation === requestGeneration && error.code === 'Conflict' && workingOid) {
        return refresh();
      }
      if (!disposed && generation === requestGeneration && error.code !== 'Cancelled') {
        status.textContent = error.message;
        workbench.host.toast(error.message, 'error');
      }
    }
  }
  async function refresh(nextRevision) {
    if (!current()) { dispose(); return; }
    controller?.abort();
    generation++;
    activeStart = undefined;
    if (nextRevision) revision = nextRevision;
    workingOid = undefined;
    pages.clear();
    total = Infinity;
    try { await workbench.synchronize(); if (current()) draw(); }
    catch (error) { status.textContent = error.message; }
  }
  const unsubscribe = workbench.host.services.get('documents').subscribe(event => {
    if (event.type === 'reset' || !current()) { dispose(); return; }
    if (event.uri !== uri) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 150);
  });
  const observer = new ResizeObserver(draw);
  observer.observe(editor.element);
  const unsubscribeView = subscribeGitEditorView(editor, { render: draw, dispose });
  if (!unsubscribeView) editor.input.addEventListener('scroll', draw);
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller?.abort();
    clearTimeout(timer);
    unsubscribe();
    unsubscribeView?.();
    observer.disconnect();
    editor.input.removeEventListener('scroll', draw);
    pages.clear();
    element.remove();
    editor.element.classList.remove('git-with-blame');
    if (previousGutterWidth) editor.element.style.setProperty('--git-editor-gutter-width', previousGutterWidth);
    else editor.element.style.removeProperty('--git-editor-gutter-width');
    if (!editor.disposed) view?.schedule();
  }
  await refresh();
  return { uri, refresh, dispose };
}
