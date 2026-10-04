import { normalizePath, ProjectSystem } from '@sharpforge/project-system';
import { BackgroundTaskBridge } from './background-tasks.js';
import { connectExplorerProjectDecorations } from './explorer-project-decorations.js';
import { createTestCodeLensProvider } from './test-code-lens.js';
import { studioDocumentProjects } from './studio-language-providers.js';
import { createRecentWorkspaces } from './recent-workspaces.js';
import { connectStudioStartupSelection } from './studio-startup-selection.js';
import { createStudioMetadataReader } from './studio-metadata-reference.js';
import { createStudioEditorHost } from './studio-editor-host.js';
import { mountStudioSessions } from './studio-session-ui.js';
import { mountStudioShell } from './studio-shell.js';

export function studioEditorOptions(settings) {
  const { endOfLine, normalizeLineEndings, ...options } = settings?.editor ?? {};
  return { ...options, ...(normalizeLineEndings ? { endOfLine } : {}) };
}

export function studioWorkspaceMetadata(state) {
  return {
    name: state.projectSystem?.solution?.name ?? state.name,
    entry: state.projectSystem?.solution?.path,
    mode: state.workspaceMode ?? 'folder'
  };
}

function mountEditorHost(context) {
  return createStudioEditorHost({
    documents: context.services.documents,
    docking: context.docking,
    commands: context.commands,
    saveAll: () => context.studioSave.all(),
    newDocument: context.newFile,
    pathDialog: context.pathDialog,
    openPath: async value => {
      const path = normalizePath(value ?? '');
      const node = [...context.explorer.view.model.nodes.values()].find(item =>
        item.path === path && ['source', 'file', 'project-file', 'assembly'].includes(item.kind));
      if (!node) throw new Error('No such file in the current workspace: ' + path);
      await context.explorer.openNode(node);
      return true;
    },
    navigate: location => context.openLocation(location),
    language: context.languageRequest
  });
}

function mountSessionUi(context) {
  return mountStudioSessions({
    services: context.services,
    docking: context.docking,
    commands: context.commands,
    document: context.document,
    state: () => context.state,
    stopAll: () => context.execution.stop({ all: true }),
    startNewInstance: (projectId, options) => context.execution.startNewInstance(projectId, options),
    revealApplication: (sessionId, reveal) => context.execution.reveals.application(sessionId, reveal),
    onError: error => context.toast(error.message, 'error'),
    navigate: frame => {
      if (frame?.source) context.openFile(frame.source);
      if (frame?.line) context.getEditor()?.gotoLine(frame.line, frame.column ?? 1);
    },
    refresh: () => {
      context.setEditorDecorations();
      context.renderPanelSoon();
    }
  });
}

async function applyConfiguration(context, { configuration, platform }) {
  const { state, nativeBuild } = context;
  state.configuration = configuration;
  if (state.nativeMode) {
    nativeBuild.settings.configuration = configuration;
    nativeBuild.settings.platform = platform;
  } else if (state.projectSystem) {
    const records = context.explorer.context().records;
    const entry = state.projectSystem.solution.path;
    state.projectSystem = new ProjectSystem(records, { configuration, maxFiles: 20000 });
    state.projectSnapshot = state.projectSystem.load(entry);
  }
  context.projects.sync();
  context.renderWorkspace();
  context.saveLocal();
}

function restoreFiles(context, files) {
  const documents = context.services.documents;
  const edits = files.filter(file => documents.get(file.uri)).map(file => ({
    uri: file.uri,
    start: 0,
    end: documents.models.get(file.uri).buffer.length,
    newText: file.text,
    version: documents.get(file.uri).version
  }));
  return context.applyEdits(edits);
}

function mountSurfaces(context, owners) {
  return mountStudioShell({
    document: context.document,
    commands: context.commands,
    performance: context.performance,
    services: context.services,
    state: () => context.state,
    docking: context.docking,
    readAssemblyReference: createStudioMetadataReader({
      state: () => context.state,
      nativeBuild: () => context.nativeBuild
    }),
    getEditor: context.getEditor,
    designer: context.getDesigner,
    requestCompiler: context.requestCompiler,
    navigate: location => context.openLocation(location),
    download: context.download,
    applyEdits: context.applyEdits,
    projectData: context.explorer.context,
    setKeymap: context.setKeymap,
    importFiles: context.importFiles,
    configureEditor: (instance, settings) => {
      const selected = settings === undefined ? owners.workbenchShell?.settings.snapshot() : settings;
      return context.editorIntegration.configure(instance, studioEditorOptions(selected));
    },
    openRecent: item => owners.recentWorkspaces.open(item),
    onError: error => context.toast(error.message, 'error'),
    onStatus: context.onStatus,
    applyConfiguration: options => applyConfiguration(context, options),
    readDisk: (uri, options) => context.diskObserver.read(uri, options),
    reloadDocument: (uri, text, options) => context.diskObserver.reload(uri, text, options),
    restoreFiles: files => restoreFiles(context, files)
  });
}

function createCodeLenses(context, shell) {
  return createTestCodeLensProvider({
    tests: shell.tests,
    getDocument: uri => context.services.documents.get(uri),
    projectIdsForUri: uri => studioDocumentProjects(context.state, context.services.documents, uri),
    execute: operation => shell.tasks.run({ label: 'Run selected test' },
      task => operation.run({ signal: task.signal }))
  });
}

function createRecents(context, shell) {
  return createRecentWorkspaces({
    recent: shell.recent,
    getCurrent: () => studioWorkspaceMetadata(context.state),
    beginLoad: context.beginWorkspaceLoad,
    readRecovery: slot => {
      try {
        return JSON.parse(context.storage.getItem(context.storageKeys[slot]));
      } catch {
        return null;
      }
    },
    openRecords: context.loadDiskRecords,
    loadSample: async (id, options) => {
      if (!context.samples.some(sample => sample.id === id)) throw new Error('Unknown example');
      const result = await context.loadSample(id, false, options);
      return result !== false;
    },
    openFolder: async (item, options) => {
      context.toast('Choose the folder for ' + item.label + ' to grant file access.');
      return context.openFolder(options);
    },
    activateCurrent: () => {
      context.setPanel('project');
      return true;
    }
  });
}

function mountHistory(context) {
  const button = context.document.createElement('button');
  button.id = 'navigate-history';
  button.className = 'icon-button';
  button.setAttribute('aria-label', 'Navigation history');
  button.title = 'Navigation history';
  button.textContent = '▾';
  button.onclick = () => {
    const rect = button.getBoundingClientRect();
    context.navigation.menu(rect.left, rect.bottom);
  };
  context.document.getElementById('navigate-back')?.after(button);
}

function installLifecycle(context, owners, disconnectTestLenses, disconnectStartup, disconnectDecorations) {
  let disposed = false;
  context.window.addEventListener('pagehide', event => {
    if (event.persisted || disposed) return;
    disposed = true;
    clearTimeout(context.state.analyzeTimer);
    clearTimeout(context.state.saveTimer);
    const disposers = [
      () => context.execution.dispose(),
      () => context.workspaceInputs.dispose(),
      () => context.workspaceLoads.dispose(),
      () => context.diskObserver.dispose(),
      () => context.studioSave.dispose(),
      () => owners.backgroundTasks.dispose(),
      disconnectTestLenses,
      () => owners.testCodeLens.dispose(),
      disconnectStartup,
      disconnectDecorations,
      () => context.advancedTools.dispose(),
      () => context.navigation.dispose(),
      () => context.watchWindows.dispose(),
      () => context.explorer.actions.dispose(),
      () => context.explorer.view.dispose?.(),
      () => owners.sessionUI.dispose(),
      () => owners.studioKeyboard.dispose(),
      () => owners.workbenchShell.dispose(),
      () => context.editorIntegration.dispose(),
      () => context.lazyFeatures.dispose(),
      () => context.runtimeTools.dispose?.(),
      () => context.projects.dispose(),
      () => context.docking.dispose(),
      () => context.services.dispose(),
      () => context.studioServices.dispose()
    ];
    const errors = [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) console.error(new AggregateError(errors, 'Studio cleanup failed'));
  });
}

function registerCommands(context, owners) {
  context.commands.configure('stop', { execute: () => context.stopActiveSession() });
  context.commands.configure('restart', {
    execute: () => context.execution.restart()
  });
  context.commands.configure('save', { title: 'Save Selected Items', label: 'Save Selected Items' });
  context.commands.register({
    id: 'document.saveAs', title: 'Save File As…', category: 'File',
    enabled: () => !context.state.nativeMode && !!context.services.documents.active,
    execute: () => context.studioSave.as()
  });
  context.menus.registerMenu('file', [['Save File As…', 'document.saveAs', '']]);
  owners.studioKeyboard.register({
    id: 'studio:new-project', command: 'newProject', keys: 'Mod+Shift+N', scope: 'Global'
  });
}

function startWorkspace(context, owners) {
  const recovered = context.recover();
  if (recovered) {
    context.renderWorkspace();
    if (context.projects.sourceUris(context.projects.selectedId).length) context.build(true);
  } else {
    context.loadSample('particles', true);
  }
  owners.workbenchShell.startup({ recovered }).catch(error => context.toast(error.message, 'error'));
  context.automation.contributeAutomation('', {
    get workbenchShell() { return owners.workbenchShell; },
    getShell: () => owners.workbenchShell,
    get sessions() { return context.services.sessions; },
    get documents() { return context.services.documents; },
    get workbenchServices() { return context.services; },
    get applicationWindows() { return owners.sessionUI.applications; }
  });
}

/** Publish each owner before installing the next dependent surface or invoking startup callbacks. */
export function mountStudioComposition(context) {
  const owners = {
    editorHost: null,
    sessionUI: null,
    workbenchShell: null,
    studioKeyboard: null,
    backgroundTasks: null,
    testCodeLens: null,
    recentWorkspaces: null
  };
  const publish = (name, owner) => {
    owners[name] = owner;
    context.publish(owners);
  };
  publish('editorHost', mountEditorHost(context));
  publish('sessionUI', mountSessionUi(context));
  const surfaces = mountSurfaces(context, owners);
  owners.workbenchShell = surfaces.shell;
  publish('studioKeyboard', surfaces.keyboard);
  publish('backgroundTasks', new BackgroundTaskBridge({
    tasks: owners.workbenchShell.tasks,
    builds: context.services.builds,
    onError: error => context.toast(error.message, 'error')
  }));
  publish('testCodeLens', createCodeLenses(context, owners.workbenchShell));
  const disconnectTestLenses = owners.testCodeLens.subscribe(event =>
    context.editorIntegration.language.invalidate('codeLens', { uri: event.uri }));
  publish('recentWorkspaces', createRecents(context, owners.workbenchShell));
  mountHistory(context);
  const disconnectStartup = connectStudioStartupSelection({
    services: context.services,
    state: () => context.state,
    save: context.saveSoon,
    onChanged: () => {
      context.renderTree();
      context.renderPanel('project');
      context.refreshEngineIndicators();
    }
  });
  const disconnectDecorations = connectExplorerProjectDecorations({ services: context.services, explorer: context.explorer.view });
  installLifecycle(context, owners, disconnectTestLenses, disconnectStartup, disconnectDecorations);
  registerCommands(context, owners);
  startWorkspace(context, owners);
  return owners;
}
