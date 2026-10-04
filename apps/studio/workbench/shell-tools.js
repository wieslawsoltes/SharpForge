import {ErrorListModel} from './tools/error-list.js';
import {OutputModel} from './tools/output.js';
import {ScopeSelector} from './tools/scope-selector.js';

const definitions = [
  ['problems', 'Error List', './tools/error-list.js', 'mountErrorList'],
  ['output', 'Output', './tools/output.js', 'mountOutput'],
  ['task-list', 'Task List', './tools/task-list.js', 'mountTaskList'],
  ['class-view', 'Class View', './tools/class-view.js', 'mountClassView'],
  ['object-browser', 'Object Browser', './tools/object-browser.js', 'mountObjectBrowser'],
  ['properties', 'Properties', './tools/properties.js', 'mountProperties'],
  ['toolbox', 'Toolbox', './tools/toolbox.js', 'mountToolbox'],
  ['outline', 'Document Outline', './tools/outline.js', 'mountOutline'],
  ['bookmarks', 'Bookmarks', './tools/bookmarks.js', 'mountBookmarks'],
  ['calls', 'Call Hierarchy', './tools/call-hierarchy.js', 'mountCallHierarchy'],
  ['code-definition', 'Code Definition', './tools/code-definition.js', 'mountCodeDefinition'],
  ['references', 'Find All References', './tools/references.js', 'mountReferences'],
  ['test-explorer', 'Test Explorer', './tools/test-explorer.js', 'mountTestExplorer'],
  ['diagnostic-timeline', 'Diagnostic Tools: App Sessions', './tools/diagnostic-timeline.js', 'mountDiagnosticTimeline'],
  ['command-window', 'Command Window', './tools/command-window.js', 'mountCommandWindow'],
  ['solution-view', 'Solution Explorer View', './tools/solution-explorer-views.js', 'mountSolutionExplorerView'],
  ['search', 'Find in Files', './tools/find-results.js', 'mountFindResults'],
  ['find-results-1', 'Find Results 1', './tools/find-results.js', 'mountFindResults'],
  ['find-results-2', 'Find Results 2', './tools/find-results.js', 'mountFindResults'],
  ['replace-files', 'Replace in Files', './tools/find-results.js', 'mountFindResults']
];

// Literal import sites let static and standalone builders discover every offline tool module.
const loaders = {
  'problems': () => import('./tools/error-list.js'), 'output': () => import('./tools/output.js'),
  'task-list': () => import('./tools/task-list.js'), 'class-view': () => import('./tools/class-view.js'),
  'object-browser': () => import('./tools/object-browser.js'), 'properties': () => import('./tools/properties.js'),
  'toolbox': () => import('./tools/toolbox.js'), 'outline': () => import('./tools/outline.js'),
  'bookmarks': () => import('./tools/bookmarks.js'), 'calls': () => import('./tools/call-hierarchy.js'),
  'code-definition': () => import('./tools/code-definition.js'), 'references': () => import('./tools/references.js'),
  'test-explorer': () => import('./tools/test-explorer.js'), 'diagnostic-timeline': () => import('./tools/diagnostic-timeline.js'),
  'command-window': () => import('./tools/command-window.js'), 'solution-view': () => import('./tools/solution-explorer-views.js'),
  'search': () => import('./tools/find-results.js'), 'find-results-1': () => import('./tools/find-results.js'),
  'find-results-2': () => import('./tools/find-results.js'), 'replace-files': () => import('./tools/find-results.js')
};

export const workbenchToolDefinitions = Object.freeze([
  ...definitions.map(([id, title]) => ({id, title, kind: 'tool'})),
  {id: 'notifications', title: 'Notifications', kind: 'tool'},
  {id: 'background-tasks', title: 'Background Tasks', kind: 'tool'}
]);

export function shellToolId(id) {
  const instance = /^tool:(output|problems|references|find-results):/u.exec(id);
  if (instance) return instance[1] === 'find-results' ? 'find-results-1' : instance[1];
  if (id.startsWith('references:')) return 'references';
  if (id.startsWith('solution-view:')) return 'solution-view';
  if (id.startsWith('output:')) return 'output';
  if (id.startsWith('problems:')) return 'problems';
  if (id.startsWith('find-results-')) return id.startsWith('find-results-2') ? 'find-results-2' : 'find-results-1';
  return id;
}

export async function mountShellTool(shell, id, host) {
  const base = shellToolId(id);
  if (base === 'notifications') {
    const dispose = shell.notifications.mount(host);
    return {refresh() {}, dispose};
  }
  if (base === 'background-tasks') {
    const dispose = shell.tasks.mount(host);
    return {refresh() {}, dispose};
  }
  const definition = definitions.find(entry => entry[0] === base);
  if (!definition) throw new Error('Unknown workbench tool ' + id);
  const module = await loaders[base]();
  if (shell.disposed) return {refresh() {}, dispose() {}};
  const scope = new ScopeSelector({sessions: shell.services.sessions, projects: () => shell.projects(),
    initial: shell.settings.get('tools', 'scopes')[id] ?? shell.instanceScopes?.get(id) ?? 'solution', persist: value => shell.settings.apply({
      tools: {scopes: {...shell.settings.get('tools', 'scopes'), [id]: value}}
    }, {scope: 'workspace'})});
  const context = () => shell.context();
  const options = {
    context, documents: shell.documents, request: shell.options.requestCompiler,
    navigate: location => shell.navigate(location), dialogs: shell.dialogs, onError: error => shell.onError(error),
    designer: shell.options.designer, tasks: shell.tasks, sessions: shell.services.sessions,
    readDocument: shell.options.readDocument, newWindow: newId => shell.activateTool(newId),
    openNew: newId => shell.activateTool(newId), symbolIndex: shell.symbols,
    assemblies: shell.options.assemblies, inspect: shell.options.inspectAssembly,
    search: shell.search, initial: shell.search.results.get(id), instanceId: id, scopeSelector: scope, replace: base === 'replace-files'
  };
  const models = {
    'task-list': shell.taskList, bookmarks: shell.bookmarks, calls: shell.calls, references: shell.references,
    'test-explorer': shell.tests, 'diagnostic-timeline': shell.timeline, 'command-window': shell.commandWindow,
    'solution-view': shell.explorerViews
  };
  options.model = models[base];
  if (base === 'problems') options.model = new ErrorListModel({diagnostics: shell.services.diagnostics, scope, context});
  if (base === 'output') options.model = new OutputModel({channels: shell.services.output, scope, context});
  if (base === 'properties') options.providers = shell.properties;
  if (base === 'toolbox') options.providers = shell.toolbox;
  if (base === 'references') options.id = id;
  if (base === 'solution-view' && id !== base) options.view = shell.explorerViews.instances.get(id);
  return module[definition[3]](host, options);
}
