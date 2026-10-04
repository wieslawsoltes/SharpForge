import { gitElement, gitButton, gitEmpty } from './git-dom.js';
import { mountVirtualRows } from './git-virtual.js';
import { createReadOnlySourceInspector, createHunkGutter } from './git-diff-view.js';

/** Historical, index and worktree comparisons share paged worker-computed line data. */
export async function renderGitDiff(element, workbench, options = {}) {
  const selection = { ...workbench.selection };
  if (!selection.path) return gitEmpty(element, 'Compare revisions', 'Choose a file in Git Changes or Git Repository.');
  const document = element.ownerDocument;
  const controller = options.controller ?? new AbortController();
  const selected = new Set();
  const view = gitElement(document, 'div', { className: 'git-diff-view', tabindex: '0', role: 'table', 'aria-label': 'File comparison' });
  const state = { comparison: null, virtual: null, sideBySide: true, mode: selection.blame ? 'blame' : 'diff', epoch: 0 };
  const error = failure => workbench.safe(async () => { throw failure; });
  const context = { document, workbench, selection, selected, view, state, signal: controller.signal, error };
  state.sources = createReadOnlySourceInspector(document, workbench, { signal: controller.signal, onError: error });
  const layout = gitButton(document, 'Inline / Side by Side', () => {
    state.sideBySide = !state.sideBySide;
    if (state.mode === 'diff' && state.comparison) mountComparison(context);
  });
  const stage = gitButton(document, selection.staged ? 'Unstage Selected Lines' : 'Stage Selected Lines',
    () => workbench.safe(() => stageSelected(context)));
  const mode = gitButton(document, 'Blame', () => workbench.safe(() => show(state.mode === 'diff' ? 'blame' : 'diff')));
  const toolbar = gitElement(document, 'div', { className: 'git-toolbar' },
    gitElement(document, 'strong', { text: selection.path }), layout, mode, stage);
  element.replaceChildren(toolbar, view, state.sources.element);

  async function show(nextMode) {
    const epoch = ++state.epoch;
    state.mode = nextMode;
    state.virtual?.dispose();
    mode.textContent = nextMode === 'diff' ? 'Blame' : 'Show Diff';
    layout.hidden = nextMode !== 'diff';
    stage.hidden = nextMode !== 'diff' || !!selection.commit;
    state.sources.element.hidden = nextMode !== 'diff';
    view.classList.toggle('git-blame-viewport', nextMode === 'blame');
    view.setAttribute('aria-label', nextMode === 'blame' ? 'File blame' : 'File comparison');
    gitEmpty(view, nextMode === 'blame' ? 'Loading blame…' : 'Loading comparison…');
    if (nextMode === 'blame') {
      const comparison = state.comparison;
      const deleted = comparison?.historical && !comparison.after.exists;
      const revision = deleted ? comparison.parent : selection.commit ?? 'HEAD';
      const path = deleted ? comparison.oldPath : selection.path;
      if (!selection.commit) await workbench.synchronize({ signal: controller.signal });
      const page = await workbench.request('blamePage', { path, revision, count: 256, workingTree: !selection.commit },
        { signal: controller.signal });
      if (controller.signal.aborted || epoch !== state.epoch || options.isCurrent && !options.isCurrent()) return;
      mountBlame(context, page);
    } else {
      state.comparison ??= await workbench.request('fileComparison', { ...selection, count: 256 }, { signal: controller.signal });
      if (controller.signal.aborted || epoch !== state.epoch || options.isCurrent && !options.isCurrent()) return;
      stage.hidden = state.comparison.historical || state.comparison.binary;
      state.sources.setComparison(state.comparison);
      mountComparison(context);
    }
  }

  await show(state.mode);
  return () => {
    controller.abort();
    state.virtual?.dispose();
    state.sources.dispose();
    if (state.comparison?.cacheKey) workbench.request('releaseViewData', { cacheKey: state.comparison.cacheKey }).catch(failure => {
      if (!['NotFound', 'Disposed', 'Cancelled'].includes(failure.code)) error(failure);
    });
  };
}

function mountComparison(context) {
  const { document, workbench, state, selection, view, signal, error } = context;
  const comparison = state.comparison;
  state.virtual?.dispose();
  if (comparison.binary) {
    gitEmpty(view, 'Binary file changed', `${comparison.before.size} bytes → ${comparison.after.size} bytes`);
    if (!comparison.historical) view.append(gitButton(document, selection.staged ? 'Unstage File' : 'Stage File',
      () => workbench.safe(() => synchronizedRequest(workbench, selection.staged ? 'unstage' : 'add', { paths: [selection.path] }))));
    return;
  }
  if (!comparison.total) return gitEmpty(view, 'Empty file', 'This comparison contains no text lines.');
  state.virtual = mountVirtualRows(view, {
    count: comparison.total, initialPage: comparison, signal, rowClass: 'git-diff-row', onError: error,
    loadPage: (start, count) => workbench.request('fileComparison', { path: selection.path, cacheKey: comparison.cacheKey, start, count }, { signal }),
    renderRow: (edit, index) => diffRow(context, edit, index)
  });
}

function diffRow(context, edit, index) {
  const { document, selected, state, workbench, selection } = context;
  const row = gitElement(document, 'div', {
    className: `git-diff-row git-${edit.type}${state.sideBySide ? ' git-diff-split' : ''}`, role: 'row',
    onclick: event => { if (!event.target.closest('input,button')) state.sources.select(index); }
  });
  const number = edit.type === 'delete' ? edit.oldLine : edit.newLine;
  const checkbox = gitElement(document, 'input', {
    type: 'checkbox', checked: selected.has(index), disabled: edit.type === 'equal' || state.comparison.historical,
    'aria-label': `Select ${edit.type} line ${number}`,
    onchange: event => { if (event.target.checked) selected.add(index); else selected.delete(index); }
  });
  const content = String(edit.line ?? '').replace(/\r?\n$/, '');
  const oldNumber = edit.type === 'insert' ? '' : edit.oldLine;
  const newNumber = edit.type === 'delete' ? '' : edit.newLine;
  const gutter = gitElement(document, 'span', { className: 'git-diff-gutter' }, checkbox,
    createHunkGutter(document, { edit, historical: state.comparison.historical, staged: selection.staged,
      stage: hunk => workbench.safe(() => stageHunk(context, hunk)),
      revert: hunk => workbench.safe(() => revertHunk(context, hunk)) }));
  row.append(gutter, gitElement(document, 'span', { className: 'git-line-number', text: state.sideBySide ? oldNumber : number }),
    gitElement(document, 'code', { text: state.sideBySide && edit.type === 'insert' ? '' : content }));
  if (state.sideBySide) row.append(gitElement(document, 'span', { className: 'git-line-number', text: newNumber }),
    gitElement(document, 'code', { text: edit.type === 'delete' ? '' : content }));
  return row;
}

async function stageSelected({ workbench, selection, selected, state }) {
  if (!selected.size) throw new Error('Select changed lines before staging.');
  const { before, after } = state.comparison;
  const params = { path: selection.path, staged: selection.staged, beforeOid: before.oid, afterOid: after.oid,
    beforeMode: before.mode, afterMode: after.mode, selectedLines: [...selected] };
  await synchronizedRequest(workbench, 'stageComparisonSelection', params);
}

function synchronizedRequest(workbench, method, params) {
  return workbench.run(async options => {
    await workbench.synchronize(options);
    return workbench.request(method, params, options);
  });
}

function selectedHunkParams({ selection, state }, hunk) {
  const { before, after } = state.comparison;
  return { path: selection.path, staged: selection.staged, beforeOid: before.oid, afterOid: after.oid,
    beforeMode: before.mode, afterMode: after.mode, hunkStart: hunk.start };
}

async function stageHunk(context, hunk) {
  const params = selectedHunkParams(context, hunk);
  await synchronizedRequest(context.workbench, 'stageComparisonSelection', params);
}

async function revertHunk(context, hunk) {
  if (!context.document.defaultView.confirm('Discard this hunk from the working file? This action cannot be undone.')) return;
  const params = selectedHunkParams(context, hunk);
  await context.workbench.run(async options => {
    await context.workbench.synchronize(options);
    const result = await context.workbench.request('revertComparisonSelection', params, options);
    await context.workbench.applyResolvedFile(result, options);
  }, { workspace: true });
}

function mountBlame({ document, workbench, state, view, signal, error }, page) {
  if (!page.total) return gitEmpty(view, 'Empty file', 'This revision has no lines to attribute.');
  state.virtual = mountVirtualRows(view, {
    count: page.total, initialPage: page, signal, rowClass: 'git-blame-row', onError: error,
    loadPage: (start, count) => workbench.request('blamePage', {
      path: page.path, revision: page.revision, workingTree: page.workingTree, workingOid: page.workingOid, start, count
    }, { signal }),
    renderRow: line => {
      const author = typeof line.author === 'string' ? line.author.replace(/ <.*$/, '') : line.author?.name ?? '';
      return gitElement(document, 'div', { className: 'git-blame-row', role: 'row' },
        gitButton(document, line.oid.slice(0, 8), () => {
          workbench.selection = { path: line.path, commit: line.oid };
          workbench.host.showPanel('git-diff');
        }, { title: line.summary, disabled: line.uncommitted,
          'aria-label': line.uncommitted ? 'Uncommitted changes' : `Show commit ${line.oid.slice(0, 8)}`, className: 'git-blame-commit' }),
        gitElement(document, 'span', { className: 'git-blame-author', text: author, title: author }),
        gitElement(document, 'span', { className: 'git-line-number', text: line.finalLine }),
        gitElement(document, 'code', { text: line.text }));
    }
  });
}
