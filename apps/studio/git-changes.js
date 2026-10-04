import { gitElement, gitButton, gitField, gitEmpty } from './git-dom.js';

/** Staged and working changes are separate controls over the real Git index. */
export function renderGitChanges(element, workbench) {
  const document = element.ownerDocument;
  const run = (action, scope) => workbench.safe(() => workbench.run(async options => {
    await workbench.synchronize(options);
    return action(options);
  }, scope));
  const toolbar = gitElement(document, 'div', { className: 'git-toolbar', role: 'toolbar', 'aria-label': 'Git repository actions' },
    gitButton(document, 'Initialize', () => workbench.initDialog()),
    gitButton(document, 'Clone', () => workbench.cloneDialog()),
    gitButton(document, 'Open Folder', () => workbench.safe(() => workbench.openDirectory())),
    gitButton(document, 'Refresh', () => workbench.safe(() => workbench.refresh())),
    gitButton(document, 'Cancel', () => workbench.controller?.abort(), { disabled: !workbench.busy, 'data-git-cancel': true }));
  element.replaceChildren(toolbar);
  const repository = gitElement(document, 'select', { 'aria-label': 'Git repository', disabled: workbench.busy,
    onchange: event => workbench.safe(() => workbench.selectRepository(event.target.value)) },
  gitElement(document, 'option', { value: '', text: 'Select repository…', disabled: true }),
  [...workbench.repositories.values()].map(item => gitElement(document, 'option', {
    value: item.repositoryId, text: `${item.name} · ${item.algorithm}`
  })));
  repository.value = workbench.repositoryId ?? '';
  if (workbench.repositories.size) element.append(gitField(document, 'Repository', repository));
  if (!workbench.repositoryId) {
    const empty = gitElement(document, 'div');
    gitEmpty(empty, 'Your source, under version control', 'Initialize the current workspace, clone a remote, or open a local Git repository.');
    element.append(empty);
    return;
  }
  const branch = gitButton(document, `⑂ ${workbench.branch ?? 'main'}`, () => workbench.branchDialog(), { className: 'git-branch' });
  const remotes = gitElement(document, 'div', { className: 'git-toolbar' }, branch,
    ...['Fetch', 'Pull', 'Push'].map(label => gitButton(document, label, () => workbench.safe(() => workbench.remoteAction(label.toLowerCase())))));
  element.append(remotes);
  const changes = workbench.changes;
  const conflicts = changes.filter(change => change.conflict);
  if (conflicts.length) element.append(changeGroup(document, workbench, 'Conflicts', conflicts, 'conflict', run));
  element.append(changeGroup(document, workbench, 'Staged Changes', changes.filter(change => change.staged && !change.conflict), 'staged', run));
  element.append(changeGroup(document, workbench, 'Changes', changes.filter(change => change.worktreeStatus !== '.' && !change.conflict), 'working', run));
  const message = gitElement(document, 'textarea', { rows: 3, placeholder: 'Describe your changes', 'aria-label': 'Commit message',
    value: workbench.commitDraft ?? '', oninput: event => { workbench.commitDraft = event.target.value; } });
  const amend = gitElement(document, 'input', { type: 'checkbox', 'aria-label': 'Amend previous commit',
    checked: workbench.amendDraft ?? false, onchange: event => { workbench.amendDraft = event.target.checked; } });
  const commit = gitButton(document, 'Commit Staged', () => run(async options => {
    if (!message.value.trim()) throw new Error('A commit message is required.');
    await workbench.request('commit', { message: message.value, amend: amend.checked }, options);
    workbench.commitDraft = '';
    workbench.amendDraft = false;
  }), { className: 'git-primary', disabled: !changes.some(change => change.staged) || conflicts.length > 0 });
  const form = gitElement(document, 'section', { className: 'git-commit' },
    gitField(document, 'Commit message', message),
    gitElement(document, 'div', { className: 'git-toolbar' }, gitElement(document, 'label', {}, amend, 'Amend'), commit,
      gitButton(document, 'Identity & Settings', () => workbench.host.showPanel('git-settings'))));
  element.append(form);
}

function changeGroup(document, workbench, title, files, kind, run) {
  const section = gitElement(document, 'section', { className: 'git-change-group' });
  const header = gitElement(document, 'header', {}, gitElement(document, 'h3', { text: `${title} (${files.length})` }));
  if (kind !== 'conflict' && files.length) header.append(gitButton(document, kind === 'staged' ? 'Unstage All' : 'Stage All',
    () => run(options => workbench.request(kind === 'staged' ? 'unstage' : 'add', { paths: files.map(file => file.path) }, options))));
  section.append(header);
  if (!files.length) section.append(gitElement(document, 'p', { className: 'git-muted', text: 'No changes' }));
  const list = gitElement(document, 'ul', { className: 'git-file-list', 'aria-label': title });
  for (const file of files) {
    const open = () => kind === 'conflict' ? workbench.openMerge(file.path) : workbench.openDiff(file.path, kind === 'staged');
    const path = gitButton(document, file.oldPath ? `${file.oldPath} → ${file.path}` : file.path, open, { className: 'git-path' });
    const row = gitElement(document, 'li', {},
      gitElement(document, 'span', { className: 'git-status-code', text: file.code ?? file.xy, 'aria-label': `Status ${file.code ?? file.xy}` }), path);
    if (kind !== 'conflict') row.append(gitButton(document, kind === 'staged' ? '−' : '+',
      () => run(options => workbench.request(kind === 'staged' ? 'unstage' : 'add', { path: file.path }, options)),
      { title: `${kind === 'staged' ? 'Unstage' : 'Stage'} ${file.path}` }));
    if (kind === 'working' && file.kind !== 'untracked') row.append(gitButton(document, 'Discard…',
      () => run(async options => {
        if (!globalThis.confirm(`Restore ${file.path} from the Git index?`)) return;
        await workbench.request('restore', { path: file.path, worktree: true, force: true }, options);
        await workbench.applyResolvedFile({ path: file.path }, options);
      }, { workspace: true }), { title: `Discard working changes in ${file.path}` }));
    list.append(row);
  }
  section.append(list);
  return section;
}
