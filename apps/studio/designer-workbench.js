import {DesignerOptionsService, initializeDesignerDocumentOptions, createDesign, designInheritancePreviewProfile} from '@sharpforge/designer';
import {DesignerTools} from './designer-tools.js';
import {DesignerDocuments} from './designer-documents.js';
import {DesignerDocumentHistory} from './designer-document-history.js';
import {ActiveDesignerTools} from './designer-active-tools.js';
import {contributeDesignerCommands} from './designer-commands.js';
import {contributeDesignerDocumentAutomation} from './designer-document-automation.js';
import {StudioDesignerSessions} from './designer-live-sessions.js';
import {createDesignerSourceServices, designerCompilationContext} from './designer-source-services.js';
import {createDesignerFileServices} from './designer-workspace-files.js';
import {DesignerProjectRoots} from './designer-project-roots.js';
import {DesignerAppHost} from './designer-app-host.js';
import {contributeDesignerAppAutomation} from './designer-app-host-automation.js';
import {isDesignerCancellation} from './designer-source-preview.js';

/** Studio's designer contribution owns routing, history, catalogs, app targets, and persistence for one workspace. */
export function createDesignerWorkbench(context) {
  return new DesignerWorkbench(context);
}

export class DesignerWorkbench {
  constructor(context) {
    this.context = context;
    this.state = context.state;
    this.epoch = 0;
    this.projectTypes = [];
    this.disposed = false;
    this.clipboardStore = {};
    this.options = new DesignerOptionsService(context.settings);
    try { this.options.load(); } catch (error) { context.toast(error.message, 'error'); }
    this.diagnostics = new Map();
    this.history = new DesignerDocumentHistory({
      files: () => this.state.files, editors: context.editors, applyEdits: context.applyEdits,
      restored: (uri, analysis) => this.documents.get(uri)?.sourceSync?.restoreHistory(analysis)
    });
    this.apps = new StudioDesignerSessions({
      request: context.runtimeRequest, getState: () => (context.runtimeState?.() ?? this.state.debug), projectName: () => this.state.name,
      compile: () => context.requestCompiler('build'), selectVisual: context.selectVisual,
      workspaceId: () => this.workspaceId(), sourceFiles: () => this.state.files.map(file => ({...file}))
    });
    this.sourceServices = createDesignerSourceServices({
      state: this.state, compiler: context.compiler, applyEdits: context.applyEdits,
      documents: () => this.documents, history: this.history, projectTypes: () => this.projectTypes
    });
    this.projectRoots = new DesignerProjectRoots({
      analyze: params => this.sourceServices.analyzeDesign(params), revision: () => this.state.revision,
      workspaceId: () => this.workspaceId(), refresh: () => {
        for (const view of this.documents?.views.values() ?? []) view.tools.updatePreview();
      },
      report: (descriptor, error) => this.publishDiagnostics(descriptor.uri, error.diagnostics?.length ? error.diagnostics : [{
        code: error.code ?? 'SFD1862', severity: 'warning', uri: descriptor.uri, message: error.message
      }])
    });
    const fileServices = createDesignerFileServices({
      ...context, documents: () => this.documents, open: uri => this.documents.open(uri, 'design')
    });
    this.fileServices = {...fileServices,
      createDesignDocument: (value = createDesign(), path) => fileServices.createDesignDocument(
        initializeDesignerDocumentOptions(value, this.options.value), path)
    };
    this.documents = new DesignerDocuments({
      state: this.state, records: context.records, openSource: context.openSource,
      resolvePanel: id => context.docking.content.get(id), createTools: (session, options) => this.createTools(session, options),
      sessionOptions: (_uri, kind) => ({viewState: {
        mode: kind === 'design' ? 'design' : this.options.value.defaultView,
        orientation: this.options.value.splitOrientation, zoom: this.options.value.zoom, snap: this.options.value.snap
      }}),
      onChange: () => context.saveSoon(), onError: error => context.toast(error.message, 'error'),
      onHistory: (uri, redo) => this.undoDesignerTransaction(uri, redo)
    });
    this.tools = new ActiveDesignerTools(this);
    this.commands = contributeDesignerCommands(context.commandRegistry, {
      documents: this.documents, getActiveUri: () => this.state.active, target: context.hostDocument,
      onError: error => context.toast(error.message, 'error')
    });
    this.disposeAutomation = contributeDesignerDocumentAutomation(context.automation, {documents: this.documents});
    this.disposeAppAutomation = contributeDesignerAppAutomation(context.automation, {
      host: () => this.getAppHost(), sessions: this.apps.registry
    });
  }

  createTools(session, options) {
    return new DesignerTools({
      ...this.context, ...this.fileServices, ...this.sourceServices, ...options, session,
      designerOptions: this.options, clipboardStore: this.clipboardStore,
      projectRoots: this.projectRoots,
      sourceFiles: () => designerCompilationContext(this.state, session.uri).files,
      workspaceId: () => this.workspaceId(),
      appSessions: this.apps.registry, refreshAppSessions: () => this.apps.refresh(),
      openDesignDocument: uri => this.documents.open(uri, 'design'),
      canUndoSource: (uri, redo) => this.canUndoSource(uri, redo),
      undoSource: (uri, redo) => this.undoSource(uri, redo),
      applySourceEdits: (uri, plan, version, current) => this.sourceServices.applySourceEdits(uri, plan, version, current, session.uri),
      reportDesignerDiagnostics: (_uri, diagnostics) => this.publishDiagnostics(session.uri, diagnostics),
      publishDesignerDiagnostics: diagnostics => this.publishDiagnostics(session.uri, diagnostics),
      writeDesignerSourceForSession: (identity, tools) => this.writeLiveSource(identity, tools),
      launchDesignerApp: options => this.getAppHost().launch(options),
      openStandaloneLiveDesign: (document, options) => this.openStandaloneLiveDesign(document, options)
    });
  }

  workspaceId() { return this.state.name + ':' + this.epoch; }

  getAppHost() {
    if (this.disposed) throw new Error('The designer workspace is closed');
    this.appHost ??= new DesignerAppHost({
      idPrefix: 'designer-app-' + this.epoch,
      sessions: this.apps.registry, sourceFiles: () => this.state.files.map(file => ({...file})),
      workspaceId: () => this.workspaceId(), projectName: () => this.state.name,
      compile: async options => {
        const selected = designerCompilationContext(this.state, options.uri ?? this.state.active);
        const result = await this.context.compiler.request('build', {
          ...selected, compilationOptions: {...selected.compilationOptions, outputKind: 'exe'}
        });
        return result.success ? {...result, compilationUris: selected.files.map(file => file.uri)} : result;
      },
      runtimeOptions: this.context.runtimeOptions,
      windowOptions: {document: this.context.hostDocument},
      onError: error => this.context.toast(error.message, 'error')
    });
    return this.appHost;
  }

  async openStandaloneLiveDesign(document, {live, reason}) {
    const session = await this.fileServices.createDesignDocument(document, 'LiveView.sfdesign.json');
    const tools = this.documents.views.get(session.uri).tools;
    const target = tools.liveAttachment.attachment.adopt(live);
    tools.live = target;
    tools.status = reason || 'Live application attached';
    tools.update({kind: 'live attach'});
    return tools.snapshot();
  }

  documentFiles() {
    const sources = new Set(this.state.files.map(file => file.uri));
    return [...this.state.files, ...this.context.records().filter(file =>
      file.path.endsWith('.sfdesign.json') && !sources.has(file.path)).map(file => ({...file, uri: file.path}))];
  }

  sourceChanged(uri, options = {}) {
    this.history.sourceChanged(uri);
    this.documents.sourceChanged(uri);
    for (const [owner, view] of this.documents.views) {
      const sync = view.tools.sourceSync;
      const primary = sync.session?.analysis.uri;
      if (owner === uri && primary === uri || !sync.session?.sources.some(file => file.uri === uri)) continue;
      sync.sourceChanged(uri, {...options, dependency: primary !== uri});
    }
  }

  canUndoSource(uri, redo = false) {
    if (this.state.readOnly) return false;
    if (this.history.canUndo(uri, redo)) return true;
    const editor = this.context.editors.get(uri);
    return (redo ? editor?.future : editor?.history)?.length > 0;
  }

  undoSource(uri, redo = false) {
    if (this.state.readOnly) throw new Error('Enable source editing before undoing C#');
    if (this.history.undo(uri, redo)) return true;
    const editor = this.context.editors.get(uri);
    if (!editor) return false;
    editor.undo(redo);
    return true;
  }

  /** Keep a rejected multi-file undo from falling through to a partial native-editor undo. */
  undoDesignerTransaction(uri, redo = false) {
    if (!this.history.canUndo(uri, redo)) return false;
    try {
      if (this.state.readOnly) throw new Error('Enable source editing before undoing C#');
      return this.history.undo(uri, redo);
    } catch (error) {
      this.context.toast(error.message, 'error');
      return true;
    }
  }

  publishDiagnostics(uri, diagnostics) {
    this.diagnostics.set(uri, diagnostics.map(diagnostic => ({...diagnostic, source: diagnostic.source ?? 'Designer'})));
    this.state.designerDiagnostics = [...this.diagnostics.values()].flat();
    this.context.renderPanel('problems');
  }

  async updateCatalog(result) {
    this.catalogOperation?.abort();
    if (this.disposed || !result.success && !designInheritancePreviewProfile(result.diagnostics)) return;
    const operation = new AbortController();
    this.catalogOperation = operation;
    const revision = this.state.revision;
    const epoch = this.epoch;
    const context = designerCompilationContext(this.state, this.state.active);
    let catalog;
    try {
      catalog = await this.context.compiler.request('designAnalyze', {...context, operation: 'catalog', success: result.success,
        workspaceId: this.workspaceId(), requestOwner: 'project-catalog', generation: epoch}, {signal: operation.signal});
    } catch (error) {
      if (!isDesignerCancellation(error)) throw error;
      return;
    }
    if (this.disposed || operation.signal.aborted || epoch !== this.epoch || revision !== this.state.revision
      || !catalog.success && !catalog.previewAvailable) return;
    this.projectTypes = catalog.projectTypes;
    this.projectRoots.setCatalog(this.projectTypes, revision);
    for (const view of this.documents.views.values()) {
      const snapshot = {success: catalog.success, previewAvailable: catalog.previewAvailable,
        projectTypes: this.projectTypes, version: revision};
      if (catalog.success) view.tools.toolbox.updateAnalysis(snapshot);
      else view.tools.toolbox.updatePreviewAnalysis(snapshot);
    }
  }

  async writeLiveSource(identity, tools) {
    const descriptor = this.apps.registry.resolve(identity.sessionId, identity.generation);
    if (descriptor.workspaceId && descriptor.workspaceId !== this.workspaceId()) throw new Error('The attached app belongs to another workspace');
    descriptor.assertSourceOwnership?.({uris: tools.sourceFiles().map(file => file.uri)});
    const before = this.state.files.map(file => ({...file}));
    await tools.sourceSync.write();
    this.apps.registry.resolve(identity.sessionId, identity.generation);
    descriptor.authorizeSourceChanges?.({before, after: this.state.files.map(file => ({...file}))});
  }

  reset() {
    this.catalogOperation?.abort();
    this.epoch++;
    this.documents.reset();
    this.history.clear();
    this.diagnostics.clear();
    this.state.designerDiagnostics = [];
    this.projectTypes = [];
    this.projectRoots.reset();
    this.clipboardStore.document = null;
    this.appHost?.dispose();
    this.appHost = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.catalogOperation?.abort();
    this.commands.dispose();
    this.disposeAutomation?.();
    this.disposeAppAutomation?.();
    this.appHost?.dispose();
    this.projectRoots.dispose();
    this.documents.dispose();
    this.history.dispose();
    this.apps.dispose();
  }
}
