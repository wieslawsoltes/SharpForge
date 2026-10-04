import {ContextKeys} from './context-keys.js';
import {contributeCommands, installCommandContext} from './commands.js';
import {DialogHost} from './dialog-host.js';
import {Announcer} from './announcer.js';
import {WorkbenchPerformance} from './perf.js';
import {ToolRenderScheduler} from './render-scheduler.js';
import {createShellModels} from './shell-models.js';
import {workbenchToolDefinitions, shellToolId, mountShellTool} from './shell-tools.js';
import {registerShellCommands} from './shell-commands.js';
import {subscribeShellServices} from './shell-events.js';
import {mountMenuBar} from './menus.js';
import {WorkbenchStatusBar, registerStatusRegions} from './status-bar.js';
import {customizeToolbars} from './toolbar-customize.js';
import {applyEnvironment} from './theme.js';
import {showFirstRun} from './first-run.js';
import {showStartWindow} from './start-window.js';
import {mountFileDrops, showRecovery} from './file-watch.js';
import {element} from './ui.js';

/** Mountable Studio composition; source/runtime ownership remains in the supplied workbench services. */
export class WorkbenchShell {
  constructor(options) {
    this.options = {...options};
    this.options.state ??= () => ({});
    this.options.designer ??= () => null;
    this.options.workspaceId ??= this.options.state().name ?? 'default';
    this.document = options.document ?? globalThis.document;
    this.root = options.root ?? this.document.body;
    this.services = options.services ?? options;
    this.documents = this.services.documents;
    this.commands = options.commands ?? options.commandRegistry;
    if (!this.documents?.list || !this.commands?.describe) throw new TypeError('WorkbenchShell requires document and command services');
    if (!this.services.output || !this.services.diagnostics) throw new TypeError('WorkbenchShell requires output and diagnostics stores');
    if (!options.requestCompiler || !options.navigate) throw new TypeError('WorkbenchShell requires compiler and navigation callbacks');
    if (!this.options.storage) {
      try { this.options.storage = globalThis.localStorage; } catch (error) { this.storageFailure = error; }
    }
    this.options.openRecent ??= async item => {
      if (item.kind === 'file') return this.navigate({uri: item.uri});
      throw new Error('Reopen this project through Open Project to restore its file permissions');
    };
    this.contextKeys = new ContextKeys();
    this.metrics = new WorkbenchPerformance(options.performance);
    this.dialogs = options.dialogs ?? new DialogHost({document: this.document, root: this.root, onError: error => this.onError(error)});
    this.scheduler = new ToolRenderScheduler(options.scheduler);
    this.toolDefinitions = workbenchToolDefinitions;
    this.mounts = new Map();
    this.loading = new Map();
    this.registeredPanels = new Set();
    this.instanceScopes = new Map();
    this.disposers = [];
    this.disposed = false;
    this.taskListDirty = true;
    createShellModels(this);
    this.updateContext();
    this.disposers.push(installCommandContext(this.commands, this.contextKeys));
    this.disposers.push(registerShellCommands(this));
    this.registerToolFactories();
    if (options.docking?.windows?.descriptors) this.registerContributions(options.docking.windows.descriptors());
    this.disposers.push(subscribeShellServices(this));
    if (this.storageFailure) this.onError(this.storageFailure);
  }

  context() {
    const state = this.options.state();
    const editor = this.options.getEditor?.();
    const caretOffset = editor?.caretOffset ?? editor?.offset ?? 0;
    const uri = state.active ?? this.documents.active;
    const file = this.documents.get(uri);
    const session = this.services.sessions?.active;
    if (this.document.activeElement?.closest('.sf-editor')) this.lastDocumentKind = 'code';
    else if (state.panel === 'designer' || state.panel?.startsWith('designer-')) this.lastDocumentKind = 'designer';
    const designer = this.lastDocumentKind === 'designer';
    return {uri, offset: editor?.offset ?? 0, selectionLength: editor?.selectionLength ??
      Math.abs((editor?.input?.selectionEnd ?? 0) - (editor?.input?.selectionStart ?? 0)),
    position: editor?.sourceSnapshot?.().positionAt(editor.offset ?? 0),
    caretOffset, caretPosition: editor?.sourceSnapshot?.().positionAt(caretOffset), tabSize: editor?.options?.tabSize,
    projectId: file?.projectId ?? this.documents.projectsFor?.(uri)?.[0] ?? this.services.builds?.activeId ?? state.startupProject,
    sessionId: session?.id, sessionCount: this.services.sessions?.list().length ?? 0,
    openUris: state.tabs ?? this.documents.tabs ?? [], activeDocumentKind: designer ? 'designer' : file ? 'code' : '',
    debugState: session?.debug?.state ?? state.debug?.state ?? 'stopped', focusedTool: state.panel,
    selectionKind: state.itemSelection?.[0]?.kind ?? '', readOnly: file?.readOnly ?? state.readOnly,
    keymap: state.keymap, ...this.options.context?.()};
  }

  projects() {
    return this.services.builds?.list().map(service => service.project) ?? this.options.state().projectSnapshot?.projects ?? [];
  }

  updateContext() {
    const context = this.context();
    const keys = ['uri', 'projectId', 'sessionId', 'sessionCount', 'activeDocumentKind', 'debugState',
      'focusedTool', 'selectionKind', 'readOnly', 'keymap'];
    this.contextKeys.update(Object.fromEntries(keys.map(key => [key, context[key]])));
    this.statusBar?.update();
  }

  async execute(id, invocation) {
    const mark = this.metrics.start('command', this.context().sessionId);
    try { return invocation ? await this.commands.invoke(id, invocation) : await this.commands.execute(id); }
    finally { this.metrics.end(mark, {command: id}); }
  }

  async navigate(location) {
    const file = this.documents.get(location.uri);
    if (location.version !== undefined && file?.version !== location.version) throw new Error('This result is stale; run the query again');
    if (!file && !location.uri?.startsWith('metadata:') && !this.options.readDocument) throw new Error('Source document is unavailable: ' + location.uri);
    const mark = this.metrics.start('document-switch', this.context().sessionId);
    try { return await this.options.navigate(location); }
    finally { this.metrics.end(mark, {uri: location.uri}); }
  }

  navigateBookmark(backwards) {
    const current = this.context();
    const item = this.bookmarks.next(current.uri, current.offset, backwards);
    if (item) return this.navigate({...item, start: item.offset});
  }

  nextResult(backwards) {
    const active = this.options.state().panel;
    return this.mounts.get(active)?.view.next?.(backwards) ?? this.mounts.get('problems')?.view.next?.(backwards);
  }

  registerContributions(descriptors) {
    const dispose = contributeCommands(this.commands, descriptors);
    this.disposers.push(dispose);
    for (const descriptor of descriptors) {
      if (!descriptor.shortcut) continue;
      const id = 'contribution:' + descriptor.id;
      if (this.options.keybindings?.list().some(binding => binding.id === id)) continue;
      const remove = this.options.keybindings?.register({id, command: descriptor.id, keys: descriptor.shortcut, scope: 'Global'});
      if (typeof remove === 'function') this.disposers.push(remove);
    }
    return dispose;
  }

  hasTool(id) { return this.toolDefinitions.some(tool => tool.id === shellToolId(id)); }

  registerToolFactories() {
    const docking = this.options.docking;
    if (!docking?.registerToolKind) return;
    for (const [kind, title] of [['output', 'Output'], ['problems', 'Error List'], ['find-results', 'Find Results']]) {
      if (docking.factories?.factories.has(kind)) continue;
      this.disposers.push(docking.registerToolKind(kind, record => {
        if (record.sessionId) this.instanceScopes.set(record.id, 'session:' + record.sessionId);
        const host = element(this.document, 'div', {className: 'panel-content dock-tool-content wb-tool', 'data-tool': record.id});
        this.registeredPanels.add(record.id);
        return host;
      }, {limit: 20, title}));
    }
  }

  registerPanel(id) {
    const docking = this.options.docking;
    if (!docking || docking.layout.panels.has(id)) return;
    const definition = this.toolDefinitions.find(tool => tool.id === shellToolId(id));
    if (!definition) throw new Error('Unknown shell tool ' + id);
    const host = element(this.document, 'div', {className: 'panel-content dock-tool-content wb-tool', 'data-tool': id});
    docking.content.set(id, host);
    docking.layout.register({...definition, id, title: definition.title + (id === definition.id ? '' : ' ' + id.split(':').at(-1))});
    this.registeredPanels.add(id);
  }

  activateTool(id) {
    this.registerPanel(id);
    const docking = this.options.docking;
    if (docking) {
      docking.activate(id);
      this.options.state().panel = id;
      const host = docking.content.get(id);
      return this.renderTool(id, host);
    }
    if (this.options.activateTool) return this.options.activateTool(id);
    throw new Error('No docking tool activation host is configured');
  }

  isToolVisible(id) {
    const docking = this.options.docking;
    if (!docking) return this.options.isToolVisible?.(id) ?? true;
    const location = docking.layout.locate(id);
    return location.group?.active === id || docking.host.autoPanel === id || Boolean(docking.host.popouts?.has(id));
  }

  async renderTool(id, host) {
    if (this.disposed || !host) return;
    if (!this.hasTool(id)) throw new Error('Unknown workbench tool ' + id);
    const existing = this.mounts.get(id);
    if (existing) { this.scheduler.invalidate(id); return; }
    if (!this.isToolVisible(id)) return;
    if (this.loading.has(id)) return this.loading.get(id);
    const load = async () => {
      const mark = this.metrics.start('tool-activation', this.context().sessionId);
      host.classList.add('wb-tool');
      host.setAttribute('aria-busy', 'true');
      try {
        const view = await mountShellTool(this, id, host);
        if (this.disposed) { view.dispose(); return; }
        const remove = this.scheduler.register(id, {render: () => view.refresh?.(), visible: () => this.isToolVisible(id)});
        this.mounts.set(id, {view, host, remove});
        if (shellToolId(id) === 'task-list' && this.taskListDirty) this.scanTasks();
      } catch (error) {
        host.replaceChildren(element(this.document, 'p', {role: 'alert', className: 'wb-error', text: error.message}));
        this.onError(error);
      } finally {
        this.loading.delete(id); host.removeAttribute('aria-busy'); this.metrics.end(mark, {tool: id});
      }
    };
    const pending = load();
    this.loading.set(id, pending);
    return pending;
  }

  invalidateTool(baseId) {
    for (const id of this.mounts.keys()) if (shellToolId(id) === baseId || id === baseId) this.scheduler.invalidate(id);
  }

  scanTasks() {
    this.taskScan?.abort();
    this.taskScan = new AbortController();
    this.taskList.scan({signal: this.taskScan.signal}).then(() => { this.taskListDirty = false; })
      .catch(error => { if (error.name !== 'AbortError') this.onError(error); });
  }

  update(event = {}) {
    if (this.disposed) return;
    this.updateContext();
    if (event.type === 'cursor') {
      this.mounts.get('outline')?.view.follow?.();
      this.invalidateTool('code-definition');
      return;
    }
    const targets = event.type === 'output' ? ['output'] : event.type === 'selection' ? ['properties', 'toolbox', 'outline'] :
      ['problems', 'output', 'properties', 'outline', 'references', 'diagnostic-timeline', 'solution-view'];
    for (const id of targets) this.invalidateTool(id);
  }

  setReferences(rows, options) {
    const files = new Map(this.documents.list().map(file => [file.uri, file]));
    const result = this.references.set(rows.map(row => ({...row, version: row.version ?? files.get(row.uri)?.version,
      projectId: row.projectId ?? files.get(row.uri)?.projectId ?? this.documents.projectsFor?.(row.uri)?.[0]})), options);
    this.activateTool(result.id);
    return result;
  }

  applySettings(settings) {
    this.restoreEnvironment?.();
    this.restoreEnvironment = applyEnvironment(this.document.documentElement, settings);
    if (this.options.applySettings) this.options.applySettings(settings);
    else {
      const preferences = {...settings.editor};
      if (!preferences.normalizeLineEndings) delete preferences.endOfLine;
      this.options.getEditor?.()?.updateOptions?.(preferences);
    }
    if (settings.environment.keymap !== this.context().keymap) this.options.setKeymap?.(settings.environment.keymap);
    if (this.options.applyKeybindings) this.options.applyKeybindings(settings.keyboard.bindings);
    this.services.sessions && (this.services.sessions.maxSessions = settings.runtime.maxSessions);
    this.fileWatch.start(settings.projects.autoRecoverSeconds);
    this.statusBar?.update();
  }

  mount({menuHost, toolbarHost, statusHost, showStartup = false, recovered = false} = {}) {
    if (this.mounted) return this;
    this.mounted = true;
    const startup = this.metrics.start('startup');
    this.announcer = new Announcer(this.root);
    const onError = error => this.onError(error);
    if (menuHost) {
      this.menuBar = mountMenuBar(menuHost, {registry: this.commands, keybindings: this.options.keybindings,
        execute: id => this.execute(id), onError, menuContributions: this.options.menuContributions});
      this.disposers.push(() => this.menuBar.dispose());
    }
    if (toolbarHost) {
      this.disposers.push(this.toolbars.mount(toolbarHost, {customize: id => customizeToolbars({dialogs: this.dialogs,
        toolbars: this.toolbars, registry: this.commands}, id)}));
      this.disposers.push(this.configuration.mount(toolbarHost, onError));
    }
    if (statusHost) {
      this.statusBar = new WorkbenchStatusBar(statusHost, {onError});
      registerStatusRegions(this.statusBar, {context: () => this.context(), documents: this.documents, tasks: this.tasks,
        notifications: this.notifications, settings: this.settings, execute: id => this.execute(id)});
    }
    this.disposers.push(this.metrics.observeInput(this.root, () => this.context().sessionId ?? 'workbench'));
    if (this.options.importFiles) this.disposers.push(mountFileDrops(this.root, {importFiles: this.options.importFiles, onError}));
    this.applySettings(this.settings.snapshot());
    if (showStartup) this.startup({recovered}).catch(onError);
    this.metrics.end(startup);
    return this;
  }

  async startup({recovered = false} = {}) {
    const first = showFirstRun({dialogs: this.dialogs, settings: this.settings});
    if (first) await first.result;
    const recovery = this.options.restoreFiles && showRecovery(this.dialogs, this.fileWatch, {restore: this.options.restoreFiles});
    if (recovery) await recovery.result;
    if (!recovered && this.settings.get('environment', 'showStartWindow')) showStartWindow({
      dialogs: this.dialogs, recent: this.recent, settings: this.settings, execute: id => this.execute(id),
      openRecent: this.options.openRecent, onError: error => this.onError(error)
    });
  }

  notify(message, severity = 'info') {
    return this.notifications.add(typeof message === 'object' ? message : {message, severity});
  }
  onError(error) {
    if (error?.name === 'AbortError' || this.disposed) return;
    this.notifications?.add({severity: 'error', message: error.message ?? String(error), code: error.code});
    this.options.onError?.(error);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.taskScan?.abort();
    this.fileWatch.dispose();
    for (const dispose of this.disposers.reverse()) dispose();
    for (const {view, remove} of this.mounts.values()) { remove(); view.dispose(); }
    for (const id of this.registeredPanels) this.options.docking?.unregisterPanel?.(id);
    this.registeredPanels.clear();
    this.mounts.clear(); this.scheduler.dispose(); this.dialogs.dispose(); this.statusBar?.dispose(); this.announcer?.dispose();
    for (const model of [this.tasks, this.notifications, this.search, this.symbols, this.taskList, this.bookmarks,
      this.calls, this.tests, this.timeline, this.references, this.recent, this.toolbars, this.configuration, this.explorerViews]) model.dispose?.();
    this.restoreEnvironment?.();
    this.contextKeys.dispose();
  }
}

export function createWorkbenchShell(options) { return new WorkbenchShell(options); }
