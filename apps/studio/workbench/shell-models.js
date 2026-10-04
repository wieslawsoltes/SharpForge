import {SettingsStore} from './settings-store.js';
import {Notifications} from './notifications.js';
import {TaskCenter} from './task-center.js';
import {RecentItems} from './recent-items.js';
import {SearchService, WorkspaceSymbolIndex} from './search-service.js';
import {OptionsDialog} from './options-dialog.js';
import {registerGeneralOptions} from './options/general-pages.js';
import {keyboardOptionsPage} from './options/keyboard-page.js';
import {UnifiedSearch} from './unified-search.js';
import {TaskListModel} from './tools/task-list.js';
import {Bookmarks} from './tools/bookmarks.js';
import {CallHierarchyModel} from './tools/call-hierarchy.js';
import {ReferenceResults} from './tools/references.js';
import {TestProviders} from './tools/test-explorer.js';
import {DiagnosticTimeline} from './tools/diagnostic-timeline.js';
import {CommandWindow} from './tools/command-window.js';
import {SolutionExplorerViews} from './tools/solution-explorer-views.js';
import {createDefaultProperties} from './tools/properties.js';
import {ToolboxProviders} from './tools/toolbox.js';
import {ConfigurationManager} from './configuration-manager.js';
import {Toolbars} from './toolbars.js';
import {FileWatch, showDiskCompare} from './file-watch.js';
import {MetadataCatalog} from './metadata/catalog.js';
import {createStudioMetadataSources} from './metadata/source-provider.js';
import {ExecutionCapture} from './tools/execution-capture.js';

/** Services are explicit dependencies; each shell has independent tool state and result windows. */
export function createShellModels(shell) {
  const {options, documents, dialogs, commands} = shell;
  const context = () => shell.context();
  const navigate = location => shell.navigate(location);
  const request = (...args) => options.requestCompiler(...args);
  shell.notifications = new Notifications({announce: (...args) => shell.announcer?.announce(...args)});
  shell.tasks = new TaskCenter();
  const notify = notification => shell.notifications.add(notification);
  shell.settings = options.settings ?? new SettingsStore({storage: options.storage, workspaceId: options.workspaceId, notify});
  shell.settings.load();
  const onError = error => shell.onError(error);
  shell.recent = new RecentItems({storage: options.storage, onError});
  shell.search = new SearchService({documents, context, applyEdits: options.applyEdits, createWorker: options.createSearchWorker,
    sessionProject: id => shell.services.sessions?.get(id)?.projectId});
  shell.symbols = new WorkspaceSymbolIndex({request, documents});
  shell.metadata = new MetadataCatalog({sources: options.metadataSources ?? createStudioMetadataSources({
    state: options.state, additional: options.assemblies, readReference: options.readAssemblyReference}),
    createWorker: options.createMetadataWorker});
  shell.optionsDialog = new OptionsDialog({dialogs, settings: shell.settings});
  registerGeneralOptions(shell.optionsDialog);
  shell.optionsDialog.register(keyboardOptionsPage({registry: commands, keybindings: options.keybindings}));
  if (options.editorOptionsPage) shell.optionsDialog.register({
    id: 'Text Editor.advanced', category: 'Text Editor', title: 'Advanced Editor Settings',
    render: (host, {draft, update}) => {
      const editor = options.getEditor?.();
      if (!editor) { host.textContent = 'Open a source document to configure its editor.'; return; }
      const preferences = {...draft.editor};
      if (!preferences.normalizeLineEndings) delete preferences.endOfLine;
      const page = options.editorOptionsPage({element: editor.element, options: {...editor.options, ...preferences},
        updateOptions: changes => { for (const [key, value] of Object.entries(changes)) update('editor', key, value); },
        accessibility: {announce() {}}});
      page.addEventListener('change', event => {
        if (event.target?.name === 'endOfLine') update('editor', 'normalizeLineEndings', true);
      });
      host.append(page);
      return () => page.remove();
    }
  });
  shell.unifiedSearch = new UnifiedSearch({registry: commands, options: shell.optionsDialog, symbols: shell.symbols,
    documents, recent: shell.recent, context, navigate, execute: id => shell.execute(id)});
  shell.taskList = new TaskListModel({documents, settings: shell.settings, storage: options.storage,
    workspaceId: options.workspaceId, createWorker: shell.search.createWorker});
  shell.bookmarks = new Bookmarks({documents, storage: options.storage, workspaceId: options.workspaceId, onError});
  shell.calls = new CallHierarchyModel({request, documents});
  shell.references = new ReferenceResults();
  shell.tests = new TestProviders();
  shell.timeline = new DiagnosticTimeline();
  if (shell.services.sessions?.list) {
    shell.executionCapture = new ExecutionCapture({sessions: shell.services.sessions, model: shell.timeline, onError});
    shell.executionCapture.start();
  }
  shell.commandWindow = new CommandWindow({registry: commands});
  shell.explorerViews = new SolutionExplorerViews({getData: options.projectData ?? (() => ({files: documents.list(), name: options.state().name})),
    documents, context, search: shell.search});
  shell.properties = createDefaultProperties({state: options.state, designer: options.designer});
  shell.toolbox = new ToolboxProviders();
  shell.toolbox.register('code-snippets', {title: 'C# Snippets', matches: current => current.activeDocumentKind === 'code',
    items: async () => {
      const snippets = options.snippets?.() ?? (await import('@sharpforge/editor')).CSHARP_SNIPPETS ?? [];
      return snippets.map(snippet => ({id: snippet.prefix, label: snippet.label, text: snippet.body, description: snippet.prefix}));
    }, insert: item => {
      const editor = options.getEditor?.();
      const insert = editor?.insertSnippet?.bind(editor) ?? editor?.insights?.insertSnippet?.bind(editor.insights);
      if (!insert) throw new Error('The active editor does not provide snippet insertion');
      return insert(item.text);
    }});
  shell.toolbox.register('designer-controls', {title: 'Designer Controls', matches: current => current.activeDocumentKind === 'designer',
    items: async () => (await import('@sharpforge/designer')).designControls.map(control => ({
      id: control.type, type: control.type, label: control.name, group: control.category
    })), insert: item => {
      const designer = options.designer?.();
      if (!designer) throw new Error('No designer document is active');
      designer.ensure?.();
      return designer.insert(item.type);
    }});
  shell.toolbox.register('clipboard-ring', {title: 'Clipboard Ring', matches: current => current.activeDocumentKind === 'code',
    items: () => (options.getEditor?.()?.clipboardRing?.entries ?? []).map((text, index) => ({
      id: String(index), label: text.slice(0, 80), description: text.length + ' characters', text
    })), insert: item => {
      const editor = options.getEditor?.();
      if (!editor?.insert || editor.input?.readOnly) throw new Error('A writable source editor is required');
      return editor.insert(item.text, editor.input.selectionStart, editor.input.selectionEnd);
    }});
  shell.configuration = new ConfigurationManager({projects: () => shell.projects(), settings: shell.settings,
    applyConfiguration: options.applyConfiguration});
  shell.toolbars = new Toolbars({registry: commands, settings: shell.settings, execute: id => shell.execute(id), onError});
  shell.fileWatch = new FileWatch({documents, storage: options.storage, workspaceId: options.workspaceId, notify,
    readDisk: options.readDisk, reload: options.reloadDocument, compare: data => showDiskCompare(dialogs, data)});
}
