import { gitElement, gitButton, gitField, gitEmpty } from './git-dom.js';
import { formatRepositoryBytes, runRepositoryMaintenance, configureRepositorySparse } from './git-repository-tool-actions.js';
import { downloadRepositoryLfs, initializeRepositorySubmodule } from './git-repository-network.js';
import { showGitArchiveImport, showGitArchiveExport } from './git-archive-dialogs.js';

function section(document, title, open = false) {
  const body = gitElement(document, 'div', { className: 'git-tools-section-body' });
  const element = gitElement(document, 'details', { className: 'git-tools-section', open },
    gitElement(document, 'summary', { text: title }), body);
  return { element, body };
}

function unavailable(document, target, result) {
  if (result.status === 'fulfilled') return false;
  target.append(gitElement(document, 'p', { className: 'git-error', role: 'alert', text: result.reason.message }));
  return true;
}

function appendRows(document, target, rows, render, signal) {
  const append = start => {
    if (signal.aborted) return;
    for (const item of rows.slice(start, start + 50)) target.append(render(item));
    if (rows.length > start + 50) {
      const more = gitButton(document, 'Show More', () => { more.remove(); append(start + 50); });
      target.append(more);
    }
  };
  append(0);
}

function lastResult(document, workbench) {
  const result = workbench.repositoryToolsResult;
  const element = gitElement(document, 'section', { className: 'git-tools-result', 'aria-label': 'Last repository tool result' });
  if (!result || result.repositoryId !== workbench.repositoryId) return element;
  element.append(gitElement(document, 'h3', { text: result.title }), gitElement(document, 'p', {
    role: result.ok ? 'status' : 'alert', className: result.ok ? 'git-muted' : 'git-error', text: result.summary
  }));
  if (result.needsAdoption) element.append(gitElement(document, 'p', { className: 'git-error', role: 'alert',
    text: 'The repository was updated, but Studio could not reload its files. Reopen this repository in Git Changes.' }));
  if (result.details) element.append(gitElement(document, 'details', {}, gitElement(document, 'summary', { text: 'Result details' }),
    gitElement(document, 'pre', { tabindex: '0', text: JSON.stringify(result.details, null, 2) })));
  return element;
}

function storageSection(context, result) {
  const { document, workbench, signal, confirm } = context;
  const group = section(document, 'Storage and integrity', true);
  const actions = gitElement(document, 'div', { className: 'git-toolbar' });
  for (const [operation, label] of [['storageUsage', 'Refresh Storage'], ['fsck', 'Check Integrity'], ['repack', 'Repack'], ['gc', 'Collect Garbage…']]) {
    actions.append(gitButton(document, label,
      () => workbench.safe(() => runRepositoryMaintenance(workbench, operation, { signal, confirm }))));
  }
  group.body.append(actions, gitElement(document, 'p', { className: 'git-muted',
    text: 'Repack retains every object. Garbage collection keeps a 14-day grace period for unreachable objects.' }));
  if (unavailable(document, group.body, result)) return group.element;
  const usage = result.value;
  const table = gitElement(document, 'dl', { className: 'git-tools-statistics' });
  for (const [label, value] of [['Total stored', formatRepositoryBytes(usage.totalBytes)], ['Objects', usage.objects],
    ['Loose objects', `${usage.looseObjects} (${formatRepositoryBytes(usage.looseBytes)})`],
    ['Packs', `${usage.packs} (${formatRepositoryBytes(usage.packBytes)})`],
    ['Pack indexes', formatRepositoryBytes(usage.indexBytes)], ['Other metadata', formatRepositoryBytes(usage.metadataBytes)]]) {
    table.append(gitElement(document, 'dt', { text: label }), gitElement(document, 'dd', { text: String(value) }));
  }
  group.body.append(table);
  return group.element;
}

function lfsSection(context, result, remoteResult) {
  const { document, workbench, signal, confirm } = context;
  const files = result.status === 'fulfilled' ? result.value : [];
  const missing = files.filter(file => file.state === 'missing').length;
  const group = section(document, `Large File Storage (${missing} missing)`, missing > 0);
  if (unavailable(document, group.body, result)) return group.element;
  if (!files.length) {
    group.body.append(gitElement(document, 'p', { className: 'git-muted', text: 'No staged LFS pointers.' }));
    return group.element;
  }
  const remotes = remoteResult.status === 'fulfilled' ? remoteResult.value : [];
  const remote = gitElement(document, 'select', { 'aria-label': 'LFS download remote' }, remotes.map(item =>
    gitElement(document, 'option', { value: item.name, text: `${item.name} — ${item.url}` })));
  remote.value = (remotes.find(item => item.name === 'origin') ?? remotes[0])?.name ?? '';
  group.body.append(gitField(document, 'Download remote', remote));
  if (!remotes.length) group.body.append(gitElement(document, 'p', {
    className: 'git-muted', text: 'Add a remote in Git Settings to download missing content.'
  }));
  unavailable(document, group.body, remoteResult);
  const list = gitElement(document, 'div', { role: 'list', className: 'git-tools-list' });
  appendRows(document, list, files, file => gitElement(document, 'article', {
    role: 'listitem', className: 'git-tools-row', 'data-lfs-path': file.path, 'data-lfs-state': file.state
  }, gitElement(document, 'strong', { text: file.path }), gitElement(document, 'p', {
    className: file.state === 'missing' ? 'git-lfs-missing' : 'git-muted',
    text: `${file.state === 'missing' ? 'Content missing' : 'Content verified in local cache'} · ${formatRepositoryBytes(file.size)}`
  }), gitElement(document, 'code', { text: `SHA-256 ${file.oid}` }), file.state === 'missing'
    ? gitButton(document, 'Download', () => workbench.safe(() => downloadRepositoryLfs(workbench, file,
      remotes.find(item => item.name === remote.value), { signal, confirm })), { disabled: !remotes.length, 'aria-label': `Download LFS ${file.path}` })
    : null), signal);
  group.body.append(list);
  return group.element;
}

function submoduleSection(context, result) {
  const { document, workbench, signal, confirm } = context;
  const modules = result.status === 'fulfilled' ? result.value : [];
  const group = section(document, `Submodules (${modules.length})`, modules.length > 0);
  if (unavailable(document, group.body, result)) return group.element;
  if (!modules.length) group.body.append(gitElement(document, 'p', { className: 'git-muted', text: 'No submodules are defined.' }));
  const list = gitElement(document, 'div', { role: 'list', className: 'git-tools-list' });
  appendRows(document, list, modules, module => gitElement(document, 'article', {
    role: 'listitem', className: 'git-tools-row', 'data-submodule-path': module.path
  }, gitElement(document, 'strong', { text: module.path }), gitElement(document, 'p', { text: module.url }),
  gitElement(document, 'code', { text: module.oid ?? 'No pinned commit' }),
  gitElement(document, 'p', { className: 'git-muted', text: module.update === 'none' ? 'Updates disabled by .gitmodules' : module.state }),
  module.checkedOutOid ? gitElement(document, 'p', { className: 'git-muted', text: `Checked out: ${module.checkedOutOid}` }) : null,
  gitButton(document, module.state === 'initialized' ? 'Update Pinned Commit…' : 'Initialize…',
    () => workbench.safe(() => initializeRepositorySubmodule(workbench, module, { signal, confirm })),
    { disabled: !module.oid || module.update === 'none', 'aria-label': `Initialize submodule ${module.path}` })), signal);
  group.body.append(list);
  return group.element;
}

function sparseSection(context, result) {
  const { document, workbench, signal } = context;
  const group = section(document, 'Sparse checkout', result.status === 'fulfilled' && result.value.enabled);
  if (unavailable(document, group.body, result)) return group.element;
  const state = result.value;
  const directories = gitElement(document, 'textarea', { name: 'directories', rows: '4', maxlength: '65536',
    value: state.directories.join('\n'), 'aria-label': 'Sparse checkout directories' });
  const apply = () => workbench.safe(() => configureRepositorySparse(workbench, { directories: directories.value, signal }));
  const form = gitElement(document, 'form', { onsubmit: event => { event.preventDefault(); apply(); } },
    gitElement(document, 'p', { className: 'git-muted', text: `${state.enabled ? 'Enabled' : 'Disabled'} · ${state.skipped} skipped index entries` }),
    gitField(document, 'Directories to keep (one per line)', directories),
    gitElement(document, 'p', { className: 'git-muted', text: 'Root-level files remain available. An empty list keeps only root-level files.' }),
    gitElement(document, 'div', { className: 'git-toolbar' }, gitButton(document, 'Apply Sparse Checkout', apply),
      gitButton(document, 'Disable Sparse Checkout', () => workbench.safe(() => configureRepositorySparse(workbench, { disable: true, signal })),
        { disabled: !state.enabled })));
  group.body.append(form);
  return group.element;
}

function archiveSection(context) {
  const { document, workbench, signal } = context;
  const group = section(document, 'Import and export');
  const actions = gitElement(document, 'div', { className: 'git-toolbar' });
  for (const format of ['zip', 'bundle']) {
    const label = format === 'zip' ? 'ZIP' : 'Bundle';
    actions.append(gitButton(document, `Export ${label}…`, () => workbench.safe(() => showGitArchiveExport(document, workbench, format, { signal }))),
      gitButton(document, `Import ${label}…`, () => workbench.safe(() => showGitArchiveImport(document, workbench, format, { signal }))));
  }
  group.body.append(actions, gitElement(document, 'p', { className: 'git-muted',
    text: 'ZIP exchanges worktree files. Bundles exchange Git objects and selected references. Imports are limited to 64 MiB.' }));
  return group.element;
}

function policySection(context, result) {
  const { document, signal } = context;
  const notices = result.status === 'fulfilled' ? result.value : [];
  const group = section(document, `Ignored executable settings (${notices.length})`, notices.length > 0);
  if (unavailable(document, group.body, result)) return group.element;
  if (!notices.length) group.body.append(gitElement(document, 'p', { className: 'git-muted', text: 'No ignored executable settings were reported.' }));
  appendRows(document, group.body, notices, notice => gitElement(document, 'p', {},
    gitElement(document, 'code', { text: notice.setting }), ` — ${notice.message}`), signal);
  return group.element;
}

/** Repository adjuncts expose real service state and retain operation results across ordinary workbench refreshes. */
export async function renderGitRepositoryTools(element, workbench) {
  if (!workbench.repositoryId) return gitEmpty(element, 'Repository Tools', 'Open or initialize a repository in Git Changes.');
  const document = element.ownerDocument;
  const repositoryId = workbench.repositoryId;
  const controller = new AbortController();
  const context = { document, workbench, signal: controller.signal, confirm: message => document.defaultView.confirm(message) };
  const root = gitElement(document, 'section', { className: 'git-repository-tools', 'aria-label': 'Repository Tools' });
  const heading = gitElement(document, 'div', { className: 'git-toolbar' }, gitElement(document, 'h2', { text: 'Repository Tools' }),
    gitButton(document, 'Refresh', () => workbench.safe(() => workbench.refresh())));
  root.append(heading, lastResult(document, workbench), gitElement(document, 'p', { role: 'status', text: 'Reading repository state…' }));
  element.replaceChildren(root);
  const names = ['storageUsage', 'lfsStatus', 'submodules', 'sparseCheckout', 'policyNotices', 'remotes'];
  const values = await Promise.allSettled(names.map(name => workbench.request(name, {}, { signal: controller.signal })));
  if (controller.signal.aborted || workbench.repositoryId !== repositoryId) return () => controller.abort();
  root.replaceChildren(heading, lastResult(document, workbench), storageSection(context, values[0]),
    lfsSection(context, values[1], values[5]), submoduleSection(context, values[2]), sparseSection(context, values[3]),
    archiveSection(context), policySection(context, values[4]));
  return () => controller.abort();
}
