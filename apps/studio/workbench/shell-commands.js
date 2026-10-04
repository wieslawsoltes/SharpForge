import {contributeCommands} from './commands.js';
import {showSettingsProfile} from './settings-profile.js';
import {showStartWindow} from './start-window.js';
import {customizeToolbars} from './toolbar-customize.js';

export function registerShellCommands(shell) {
  const search = settings => shell.unifiedSearch.open(shell.dialogs, {...settings, onError: error => shell.onError(error)});
  const descriptor = (id, title, execute, shortcut = '', enabled = true) => ({id, title, execute, shortcut, enabled, category: 'Workbench'});
  const commands = [
    descriptor('workbench.options', 'Options', () => shell.optionsDialog.open()),
    descriptor('settings', 'Options', () => shell.optionsDialog.open()),
    descriptor('workbench.keyboard', 'Options: Keyboard', () => shell.optionsDialog.open('Environment.keyboard')),
    descriptor('workbench.settingsProfile', 'Import and Export Settings', () => showSettingsProfile({
      dialogs: shell.dialogs, settings: shell.settings, download: shell.options.download, onError: error => shell.onError(error)
    })),
    descriptor('commands', 'Search Features and Code', () => search({}), 'Ctrl+Q'),
    descriptor('workbench.goToAll', 'Go To All', invocation => search({goTo: true,
      query: invocation?.args?.[0]?.query ?? ''}), 'Ctrl+T'),
    descriptor('workbench.goToLine', 'Go To Line', () => search({goTo: true, query: ':'}), 'Ctrl+G'),
    descriptor('workbench.recent', 'Go To Recent File', () => search({goTo: true, query: 'recent '})),
    descriptor('workbench.replaceFiles', 'Replace in Files', () => shell.activateTool('replace-files'), 'Ctrl+Shift+H'),
    descriptor('findFiles', 'Find in Files', () => shell.activateTool('search'), 'Ctrl+Shift+F'),
    descriptor('workbench.start', 'Start Window', () => showStartWindow({dialogs: shell.dialogs, recent: shell.recent,
      settings: shell.settings, execute: id => shell.execute(id), openRecent: shell.options.openRecent, onError: error => shell.onError(error)})),
    descriptor('workbench.toolbars', 'Customize Toolbars', () => customizeToolbars({dialogs: shell.dialogs, toolbars: shell.toolbars,
      registry: shell.commands})),
    descriptor('workbench.configuration', 'Configuration Manager', () => shell.configuration.open(shell.dialogs)),
    descriptor('workbench.commandWindow', 'Command Window', () => shell.activateTool('command-window'), 'Ctrl+Alt+A'),
    descriptor('workbench.performance', 'Export Workbench Performance Trace', () =>
      shell.options.download('SharpForge.workbench-trace.json', shell.metrics.export(), 'application/json')),
    descriptor('workbench.bookmark.toggle', 'Toggle Bookmark', () => shell.bookmarks.toggle(shell.context().uri, shell.context().offset),
      'Ctrl+K Ctrl+K', context => context.activeDocumentKind === 'code'),
    descriptor('workbench.bookmark.next', 'Next Bookmark', () => shell.navigateBookmark(false), 'Ctrl+K Ctrl+N'),
    descriptor('workbench.bookmark.previous', 'Previous Bookmark', () => shell.navigateBookmark(true), 'Ctrl+K Ctrl+P'),
    descriptor('workbench.nextResult', 'Go To Next Message', () => shell.nextResult(false), 'F8'),
    descriptor('workbench.previousResult', 'Go To Previous Message', () => shell.nextResult(true), 'Shift+F8'),
    descriptor('workbench.tests.run', 'Run All Tests', () => shell.tests.run(), '', () => shell.tests.providers.size > 0),
    descriptor('workbench.tests.failed', 'Run Failed Tests', () => shell.tests.run([...shell.tests.tests.values()]
      .filter(test => test.state === 'failed').map(test => test.id)), '', () => shell.tests.providers.size > 0),
    descriptor('tool:diagnostics', 'Diagnostic Tools: App Sessions', () => shell.activateTool('diagnostic-timeline')),
    descriptor('workbench.solutionView', 'New Solution Explorer View', () => shell.activateTool(shell.explorerViews.create().id))
  ];
  for (const tool of shell.toolDefinitions) commands.push(descriptor('tool:' + tool.id, tool.title, () => shell.activateTool(tool.id)));
  const remove = contributeCommands(shell.commands, commands);
  const removeBindings = [];
  for (const command of commands.filter(item => item.shortcut)) {
    const key = 'shell:' + command.id;
    if (shell.options.keybindings?.list().some(binding => binding.id === key)) continue;
    const remover = shell.options.keybindings?.register({id: key, command: command.id, keys: command.shortcut, scope: 'Global', priority: 10});
    if (typeof remover === 'function') removeBindings.push(remover);
  }
  return () => { for (const remove of removeBindings) remove(); remove(); };
}
