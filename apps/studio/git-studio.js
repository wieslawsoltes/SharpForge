import { gitExplorerItems } from './git-explorer-overlay.js';

const definitions = Object.freeze([
  ['git-changes', 'Git Changes'], ['git-repository', 'Git Repository'], ['git-diff', 'Git Diff'],
  ['git-merge', 'Merge Conflicts', 'git.mergeConflicts'],
  ['git-providers', 'Pull Requests & Issues'], ['git-settings', 'Git Settings'],
  ['git-collaboration', 'Live Collaboration'], ['git-snapshot', 'Remote Snapshot'],
  ['git-maintenance', 'Repository Tools']
]);

const panelCommandId = ([id, , command]) => command ?? `git.${id.slice(4)}`;

/** Register cheap shell contributions; repository engines load on the first Git action. */
export function registerGitStudio(host) {
  const commands = host.services.get('commands');
  const menus = host.services.get('menus');
  const tools = host.services.get('tools');
  const disposables = [];
  let pending;
  let closed = false;
  const load = () => pending ??= import('./git-workbench.js').then(({ GitWorkbench }) => {
    if (closed) throw new Error('Studio was disposed');
    return new GitWorkbench(host);
  });
  const invoke = action => load().then(action).catch(error => host.toast(error?.message ?? String(error), 'error'));
  disposables.push(host.services.get('artifacts').register('git.credentials', async (artifact, options) => {
    if (!pending) return artifact;
    const workbench = await pending;
    return workbench.preferences.auth('sanitizeArtifact', artifact, options);
  }));
  disposables.push(menus.registerMenu('explorer', (node, nodes) => gitExplorerItems(node, nodes, invoke)));
  for (const definition of definitions) {
    const [id, title] = definition;
    host.toolDefinitions.push({ id, title, kind: 'tool' });
    disposables.push(tools.registerTool(id, title, (element, { state }) => {
      state.gitMounted = true;
      state.revision = (state.revision ?? 0) + 1;
      const revision = state.revision;
      element.setAttribute('aria-busy', 'true');
      invoke(async workbench => {
        if (revision !== state.revision) return;
        await workbench.render(id, element, state);
        if (revision === state.revision) element.setAttribute('aria-busy', 'false');
      });
    }, (element, { state }) => {
      state.gitMounted = false;
      state.gitGeneration = (state.gitGeneration ?? 0) + 1;
      state.revision++;
      state.renderController?.abort();
      state.dispose?.();
      state.dispose = null;
      element.removeAttribute('aria-busy');
    }));
    disposables.push(commands.registerCommand(panelCommandId(definition), title, '', () => host.showPanel(id)));
  }
  for (const [id, title, action] of [
    ['clone', 'Clone Repository…', workbench => workbench.cloneDialog()],
    ['init', 'Initialize Repository…', workbench => workbench.initDialog()],
    ['open', 'Open Local Repository…', workbench => workbench.openDirectory()],
    ['fetch', 'Fetch', workbench => workbench.remoteAction('fetch')],
    ['pull', 'Pull', workbench => workbench.remoteAction('pull')],
    ['push', 'Push', workbench => workbench.remoteAction('push')],
    ['branch', 'Switch Branch…', workbench => workbench.branchDialog()],
    ['createBranch', 'Create Branch…', workbench => workbench.createBranchDialog()],
    ['merge', 'Merge Branch…', workbench => workbench.mergeDialog()],
    ['blameMargin', 'Toggle Blame Margin', workbench => workbench.toggleBlameMargin()]
  ]) disposables.push(commands.registerCommand(`git.${id}`, title, '', () => invoke(action)));
  const items = [
    ['Git Changes', 'git.changes'], ['Git Repository', 'git.repository'], null,
    ['Clone Repository…', 'git.clone'], ['Initialize Repository…', 'git.init'], ['Open Local Repository…', 'git.open'], null,
    ['Fetch', 'git.fetch'], ['Pull', 'git.pull'], ['Push', 'git.push'], ['Switch Branch…', 'git.branch'],
    ['Create Branch…', 'git.createBranch'], ['Merge Branch…', 'git.merge'], null,
    ['Pull Requests & Issues', 'git.providers'], ['Git Settings', 'git.settings'],
    ['Toggle Blame Margin', 'git.blameMargin'], ['Live Collaboration', 'git.collaboration'],
    ['Open Remote Snapshot', 'git.snapshot'], ['Repository Tools', 'git.maintenance']
  ];
  const windowItems = definitions.map(definition => [definition[1], panelCommandId(definition)]);
  disposables.push(menus.registerMenu('git', items), menus.registerMenu('window', windowItems));
  disposables.push(menus.registerTopMenu({
    id: 'git', title: 'Git', mnemonic: 'g', before: 'build', commands: items.filter(Boolean).map(([, command]) => command)
  }));
  const menu = document.createElement('button');
  menu.dataset.menu = 'git';
  menu.textContent = 'Git';
  document.querySelector('.menubar [data-menu="build"]')?.before(menu);
  const indicator = document.createElement('button');
  indicator.className = 'git-status-indicator';
  indicator.textContent = '⑂ Git';
  indicator.setAttribute('aria-label', 'Open Git Changes');
  indicator.onclick = () => host.showPanel('git-changes');
  document.querySelector('.statusbar .status-spacer')?.after(indicator);
  host.gitIndicator = indicator;
  const registration = {
    dispose() {
      if (closed) return;
      closed = true;
      for (const dispose of disposables.reverse()) dispose();
      menu.remove();
      indicator.remove();
      if (pending) void pending.then(workbench => workbench.dispose()).catch(error => host.toast(error?.message ?? String(error), 'error'));
    }
  };
  host.services.register('git', () => registration, service => service.dispose());
  return registration;
}
