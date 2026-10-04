import { layoutCommitGraph } from '@sharpforge/git';
import { gitElement, gitButton, gitEmpty } from './git-dom.js';
import { mountVirtualRows } from './git-virtual.js';
import { renderRepositoryReferences } from './git-repository.js';

const palette = ['#4296fa', '#dc92f6', '#3dc8af', '#e2b559', '#f17e92', '#92b954'];

/** Repository references, path-aware history and commit details retain bounded visible DOM rows. */
export async function renderGitRepository(element, workbench) {
  if (!workbench.repositoryId) return gitEmpty(element, 'Repository history', 'Open or initialize a repository in Git Changes.');
  const document = element.ownerDocument;
  const controller = new AbortController();
  const filters = { revision: workbench.historyFilter?.revision ?? (workbench.historyPath ? 'HEAD' : null),
    path: workbench.historyPath ?? workbench.historyFilter?.path ?? '', follow: workbench.historyFilter?.follow ?? true };
  const state = { commits: [], visible: [], graph: null, selected: -1, virtual: null, files: null, epoch: 0, detailEpoch: 0, maxCount: 10000 };
  const sidebar = gitElement(document, 'aside', { className: 'git-repository-references' });
  const viewport = gitElement(document, 'div', { className: 'git-history-viewport', tabindex: '0', role: 'listbox', 'aria-label': 'Commit history' });
  const detail = gitElement(document, 'section', { className: 'git-commit-detail', 'aria-label': 'Commit details' });
  const caption = gitElement(document, 'span', { className: 'git-muted', role: 'status' });
  const main = gitElement(document, 'div', { className: 'git-repository-main' }, caption, viewport, detail);
  const body = gitElement(document, 'div', { className: 'git-repository-layout' }, workbench.historyOnly ? null : sidebar, main);
  const context = { document, workbench, filters, state, viewport, detail, caption, signal: controller.signal };
  const toolbar = historyToolbar(context);
  element.replaceChildren(toolbar.element, body);

  context.reload = async () => {
    const epoch = ++state.epoch;
    workbench.historyFilter = { ...filters };
    workbench.historyPath = filters.path;
    const commits = await workbench.request('log', {
      all: !filters.revision, revision: filters.revision ?? undefined, path: filters.path || undefined,
      follow: !!filters.path && filters.follow, maxCount: state.maxCount
    }, { signal: controller.signal });
    if (controller.signal.aborted || epoch !== state.epoch) return;
    state.commits = commits;
    state.graph = layoutCommitGraph(commits);
    state.selected = -1;
    state.detailEpoch++;
    state.files?.dispose();
    detail.replaceChildren();
    viewport.scrollTop = 0;
    caption.textContent = `${filters.revision ?? 'All references'} · ${commits.length} commits${filters.path ? ` · ${filters.path}` : ''}`;
    toolbar.more.hidden = commits.length < state.maxCount || state.maxCount >= 100000;
    filterHistory(context, toolbar.search.value);
  };
  viewport.addEventListener('keydown', event => historyKey(context, event));
  const references = workbench.historyOnly ? Promise.resolve() : renderRepositoryReferences(sidebar, workbench, {
    signal: controller.signal,
    onSelect: revision => workbench.safe(async () => { filters.revision = revision; await context.reload(); })
  });
  await Promise.all([context.reload(), references]);
  return () => { controller.abort(); state.virtual?.dispose(); state.files?.dispose(); };
}

function historyToolbar(context) {
  const { document, workbench, filters, state } = context;
  const search = gitElement(document, 'input', { type: 'search', placeholder: 'Messages, authors or object IDs', 'aria-label': 'Search commits' });
  const path = gitElement(document, 'input', { type: 'search', placeholder: 'File history path', 'aria-label': 'File history path', value: filters.path });
  const follow = gitElement(document, 'input', { type: 'checkbox', checked: filters.follow, 'aria-label': 'Follow file renames' });
  const submit = async event => {
    event?.preventDefault();
    filters.path = path.value.trim();
    filters.follow = follow.checked;
    await context.reload();
  };
  const more = gitButton(document, 'Load More Commits', () => workbench.safe(async () => {
    state.maxCount = Math.min(100000, state.maxCount + 10000);
    await context.reload();
  }));
  more.hidden = true;
  const element = gitElement(document, 'form', { className: 'git-toolbar git-history-filters', onsubmit: event => workbench.safe(() => submit(event)) },
    search, path, gitElement(document, 'label', { className: 'git-check-label' }, follow, 'Follow renames'),
    gitButton(document, 'Apply File Filter', () => workbench.safe(() => submit())),
    gitButton(document, 'All Files', () => { path.value = ''; workbench.safe(() => submit()); }));
  if (workbench.branchDialog) element.append(gitButton(document, 'Switch Branch', () => workbench.branchDialog()));
  if (workbench.createBranchDialog) element.append(gitButton(document, 'Create Branch', () => workbench.createBranchDialog()));
  if (workbench.mergeDialog) element.append(gitButton(document, 'Merge Branch', () => workbench.mergeDialog()));
  element.append(gitButton(document, 'Refresh', () => workbench.safe(() => context.reload())), more);
  search.addEventListener('input', () => filterHistory(context, search.value));
  return { element, search, more };
}

function filterHistory(context, query) {
  const { document, state, viewport, signal, workbench } = context;
  const filter = query.toLowerCase();
  state.visible = state.commits.map((commit, index) => ({ commit, index })).filter(({ commit }) =>
    `${commit.oid} ${commit.message} ${authorName(commit.author)}`.toLowerCase().includes(filter));
  state.selected = -1;
  state.virtual?.dispose();
  viewport.scrollTop = 0;
  if (!state.visible.length) return gitEmpty(viewport, 'No matching commits', 'Adjust the reference, file path or search filter.');
  // Four rows per side leave room for partial rows within the history's ten-row DOM budget.
  state.virtual = mountVirtualRows(viewport, {
    count: state.visible.length, rowHeight: 30, overscan: 4, canvasClass: 'git-history-content', rowClass: 'git-history-row', signal,
    initialPage: { start: 0, rows: state.visible.slice(0, 256) },
    loadPage: (start, count) => ({ rows: state.visible.slice(start, start + count) }),
    onError: error => workbench.safe(async () => { throw error; }),
    renderRow: ({ commit, index }, position) => {
      const row = gitElement(document, 'button', {
        type: 'button', className: 'git-history-row', role: 'option', 'aria-selected': String(position === state.selected),
        onclick: () => workbench.safe(() => selectCommit(context, position))
      });
      const ratio = document.defaultView.devicePixelRatio || 1;
      const width = Math.max(28, state.graph.width * 16 + 12);
      const canvas = gitElement(document, 'canvas', { width: width * ratio, height: 30 * ratio, 'aria-hidden': 'true' });
      canvas.style.width = `${width}px`;
      canvas.style.height = '30px';
      paintGraph(canvas, state.graph.rows[index], 30, ratio);
      row.append(canvas, gitElement(document, 'span', { className: 'git-history-message', text: commit.message.split('\n', 1)[0] }),
        gitElement(document, 'span', { className: 'git-history-author', text: authorName(commit.author) }),
        gitElement(document, 'code', { text: commit.oid.slice(0, 8) }));
      return row;
    }
  });
}

function historyKey(context, event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const { state, viewport, workbench } = context;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? state.visible.length - 1
    : state.selected + (event.key === 'ArrowDown' ? 1 : -1);
  const position = Math.max(0, Math.min(state.visible.length - 1, next));
  viewport.scrollTop = Math.max(0, position * 30 - viewport.clientHeight / 2);
  workbench.safe(() => selectCommit(context, position));
}

async function selectCommit(context, position, parentIndex = 0) {
  const { document, workbench, state, detail, signal } = context;
  if (!state.visible[position]) return;
  state.selected = position;
  state.virtual?.refresh();
  state.files?.dispose();
  const { commit } = state.visible[position];
  const epoch = ++state.detailEpoch;
  const heading = gitElement(document, 'h3', { text: commit.message.split('\n', 1)[0] });
  const metadata = gitElement(document, 'p', { className: 'git-muted', text: `${commit.oid} · ${authorName(commit.author)}` });
  const actions = gitElement(document, 'div', { className: 'git-toolbar' },
    gitButton(document, 'Cherry-pick', () => workbench.safe(() => replayCommit(workbench, 'cherryPick', commit.oid))),
    gitButton(document, 'Revert', () => workbench.safe(() => replayCommit(workbench, 'revert', commit.oid))));
  if (commit.parents.length > 1) {
    const parent = gitElement(document, 'select', { 'aria-label': 'Comparison parent' },
      commit.parents.map((oid, index) => gitElement(document, 'option', { value: index, text: `Parent ${index + 1}: ${oid.slice(0, 8)}` })));
    parent.value = String(parentIndex);
    parent.addEventListener('change', () => workbench.safe(() => selectCommit(context, position, Number(parent.value))));
    actions.append(parent);
  }
  detail.replaceChildren(heading, metadata, actions, gitElement(document, 'pre', { text: commit.message }));
  const changed = await workbench.request('commitDetail', { commit: commit.oid, parentIndex }, { signal });
  if (signal.aborted || epoch !== state.detailEpoch) return;
  detail.append(gitElement(document, 'p', { className: 'git-muted', text: changed.parent
    ? `${changed.files.length} changed files compared with ${changed.parent.slice(0, 8)}`
    : changed.commit.shallow ? `${changed.files.length} files at this shallow history boundary`
      : `${changed.files.length} files introduced by this root commit` }));
  const files = gitElement(document, 'div', { className: 'git-commit-files', role: 'list', 'aria-label': 'Changed files' });
  detail.append(files);
  if (!changed.files.length) return gitEmpty(files, 'No file changes');
  state.files = mountVirtualRows(files, {
    count: changed.files.length, rowHeight: 28, signal, rowClass: 'git-commit-file',
    initialPage: { start: 0, rows: changed.files.slice(0, 256) },
    loadPage: (start, count) => ({ rows: changed.files.slice(start, start + count) }),
    renderRow: file => gitButton(document, `${file.status} ${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}`, () => {
      workbench.selection = { path: file.path, commit: commit.oid, parentIndex };
      workbench.host.showPanel('git-diff');
    }, { className: 'git-path git-commit-file', role: 'listitem' })
  });
}

function replayCommit(workbench, method, revision) {
  return workbench.run(async options => {
    await workbench.synchronize(options);
    const result = await workbench.request(method, { revision, dirtyPaths: [...workbench.host.getState().dirtyFiles] }, options);
    await workbench.adoptRepository(options);
    if (result.conflicts?.length) workbench.openMerge(result.conflicts[0].path);
    return result;
  }, { workspace: true });
}

function authorName(author) {
  return typeof author === 'string' ? author.replace(/ <.*$/, '') : author?.name ?? '';
}

function paintGraph(canvas, row, height, ratio) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(ratio, ratio);
  context.lineWidth = 1.5;
  const x = lane => lane * 16 + 12;
  for (const lane of row.through) {
    context.strokeStyle = palette[lane % palette.length];
    context.beginPath(); context.moveTo(x(lane), 0); context.lineTo(x(lane), height); context.stroke();
  }
  for (const edge of row.edges) {
    context.strokeStyle = palette[edge.to % palette.length];
    context.beginPath(); context.moveTo(x(row.lane), height / 2);
    context.bezierCurveTo(x(row.lane), height, x(edge.to), height / 2, x(edge.to), height); context.stroke();
  }
  context.strokeStyle = palette[row.lane % palette.length];
  context.beginPath(); context.moveTo(x(row.lane), 0); context.lineTo(x(row.lane), height / 2); context.stroke();
  context.fillStyle = palette[row.lane % palette.length];
  context.beginPath(); context.arc(x(row.lane), height / 2, 4, 0, Math.PI * 2); context.fill();
}
