import {
  CSharpDesignSession, DesignSyncProtocol, designSourceSnapshot, designPreviewCapability, designProtectedEventPreviewCapability
} from '@sharpforge/designer';
import { renderSourceSyncControls, bindSourceSyncControls } from './designer-source-controls.js';
import {createDesignerSourceEvent} from './designer-source-events.js';
import {designerSourceDocument, retainDesignerRuntimeBindings} from './designer-source-projection.js';
import {
  setSourceAuthoringCapability, publishSourceCatalog, navigateReadOnlySourceEvent, markSourcePreviewBaseline,
  isDesignerCancellation, firstSourceError
} from './designer-source-preview.js';

const ignoredChanges = new Set(['selection', 'initialize', 'saved', 'source sync', 'live apply', 'live attach', 'capability']);

/** Revision-guarded source coordination. Studio performs parsing and edit planning in its compiler worker. */
export class DesignerSourceSync {
  constructor(view) {
    this.view = view;
    this.session = null;
    this.protocol = null;
    this.auto = true;
    this.state = 'unlinked';
    this.message = 'Open a compatible C# document to edit code and design together.';
    this.generation = 0;
    this.loading = false;
    this.writing = false;
    this.pending = null;
    this.disposed = false;
    this.diagnostics = [];
    this.sourceTimer = null;
    this.designTimer = null;
    this.operation = null;
  }

  file() { return this.view.sourceFiles?.().find(file => file.uri === this.session?.analysis.uri); }
  dirty() { return this.protocol?.designDirty ?? false; }
  handlerCandidates() { return this.session?.analysis.handlers ?? []; }
  createEventHandler(request) { this.assertCanApply(); return createDesignerSourceEvent(this, request); }
  navigateEvent(nodeId, event) {
    return this.view.analyzeDesign ? createDesignerSourceEvent(this, {nodeId, event}, {navigateOnly: true})
      : navigateReadOnlySourceEvent(this, nodeId, event);
  }

  assertCanApply() {
    if (this.session?.analysis.canApply === false) {
      throw Object.assign(new Error(this.session.analysis.previewCapability?.reason ??
        'This source cannot be changed by the current compiler target.'), {code: 'SFSYNC_COMPILE'});
    }
  }

  reportOperationError(error) {
    if (!isDesignerCancellation(error)) this.report('blocked', error.message, error.diagnostics ?? []);
  }

  snapshot() {
    return {
      uri: this.session?.analysis.uri ?? null, method: this.session?.analysis.method?.name ?? null,
      state: this.state, message: this.message, auto: this.auto, dirty: this.dirty(),
      warnings: this.session?.analysis.warnings ?? [], diagnostics: [...this.diagnostics],
      structuralEditable: this.session?.analysis.structuralEditable ?? false,
      canApply: this.session?.analysis.canApply !== false,
      readOnly: this.session?.analysis.readOnly === true,
      generation: this.generation, pending: this.writing
    };
  }

  report(state, message, diagnostics = this.diagnostics) {
    if (this.disposed) return;
    this.state = state;
    this.message = message;
    this.diagnostics = diagnostics;
    this.view.chrome?.renderSync();
    this.view.status = message;
    if (this.view.statusElement) this.view.statusElement.textContent = message;
    this.view.documentHost?.setDiagnostics?.(diagnostics);
    this.view.reportDesignerDiagnostics?.(this.session?.analysis.uri, diagnostics);
    this.view.accessibility?.announce?.(message);
  }

  cancelPending() {
    clearTimeout(this.sourceTimer);
    clearTimeout(this.designTimer);
    this.operation?.abort();
    this.operation = null;
  }

  async analyze(file, previous = null, {signal} = {}) {
    if (previous) previous = {...previous, document: this.view.document.snapshot()};
    if (this.view.analyzeDesign) return this.view.analyzeDesign({
      operation: 'analyze', uri: file.uri, previous, generation: this.generation, signal,
      requestOwner: 'source:' + (this.view.session?.uri ?? file.uri), workspaceId: this.view.workspaceId?.()
    });
    const session = new CSharpDesignSession(file.text, {uri: file.uri, sources: this.view.sourceFiles?.(), previous, signal});
    const analysis = designSourceSnapshot(session.analysis);
    let capability = designPreviewCapability(session.analysis);
    if (!capability.previewAvailable) capability = designProtectedEventPreviewCapability(session.analysis);
    analysis.canApply = analysis.compilationSucceeded;
    analysis.readOnly = !analysis.compilationSucceeded && capability.previewAvailable;
    analysis.previewCapability = capability;
    return {success: analysis.compilationSucceeded, previewAvailable: capability.previewAvailable,
      analysis, diagnostics: analysis.diagnostics, document: analysis.document};
  }

  /** A failed link retains the existing document and its last valid preview. */
  async connect(uri) {
    if (this.disposed) throw new Error('Designer source session is disposed');
    this.view.ensure();
    const files = this.view.sourceFiles?.() ?? [];
    uri ??= this.view.session?.uri ?? this.view.state.active ?? files[0]?.uri;
    if (!uri) return null;
    const file = files.find(item => item.uri === uri);
    if (!file) throw new Error('C# source file is not open in this workspace');
    this.cancelPending();
    const operation = new AbortController();
    this.operation = operation;
    const generation = ++this.generation;
    const version = file.version;
    const candidate = await this.analyze(file, null, {signal: operation.signal});
    if (generation !== this.generation || this.disposed || file.version !== version ||
      candidate.workspaceRevision !== undefined && candidate.workspaceRevision !== this.view.state.revision) {
      throw Object.assign(new Error('Source changed while opening its design preview; open it again to use the current source'), {
        code: 'SFSYNC_STALE'
      });
    }
    if (candidate.success === false && !candidate.previewAvailable || !candidate.analysis?.document) {
      const diagnostics = candidate.diagnostics ?? [];
      this.report('blocked', firstSourceError(diagnostics)?.message ?? 'The document has no valid design preview yet', diagnostics);
      throw Object.assign(new Error(this.message), {diagnostics});
    }
    const primary = files.find(item => item.uri === candidate.analysis.uri);
    if (!primary) throw new Error('Construction source is no longer in the workspace');
    this.protocol?.dispose();
    this.session = { analysis: candidate.analysis, sources: files.map(item => ({ ...item })) };
    this.session.analysis.text ??= primary.text;
    this.session.analysis.warnings ??= candidate.diagnostics?.filter(item => item.severity !== 'error') ?? [];
    this.loading = true;
    try {
      this.view.replace(candidate.analysis.document, {path: uri.replace(/(?:\.g)?\.cs$/i, '.sfdesign.json')});
      setSourceAuthoringCapability(this, candidate.analysis);
    }
    finally { this.loading = false; }
    this.protocol = new DesignSyncProtocol({
      workspaceId: this.view.workspaceId?.() ?? this.view.state.name ?? 'workspace', uri: primary.uri,
      sourceText: primary.text, sourceVersion: primary.version ?? 0, document: designerSourceDocument(this.view.document.value),
      designRevision: this.view.document.revision, generation
    });
    markSourcePreviewBaseline(this, candidate.analysis, candidate.diagnostics ?? []);
    if (candidate.success === false) this.report('blocked', firstSourceError(candidate.diagnostics ?? [])?.message ??
      'Preview requires another compilation target',
      candidate.diagnostics ?? []);
    else this.report('synced', 'Linked ' + uri + ' · ' + (candidate.analysis.method?.name ?? 'construction method'), []);
    publishSourceCatalog(this, candidate, candidate.revision ?? candidate.workspaceRevision ?? version);
    if (!this.view.documentHost) this.view.chrome?.setMode('split');
    return this.snapshot();
  }

  disconnect() {
    this.generation++;
    this.cancelPending();
    this.protocol?.dispose();
    this.protocol = null;
    this.session = null;
    if (!this.view.document.disposed) this.view.document.setReadOnly(false);
    this.report('unlinked', 'C# link disconnected; the design document is retained.', []);
  }

  designChanged(event) {
    if (!this.session || !this.protocol || this.loading || ignoredChanges.has(event.kind)) return;
    const file = this.file();
    if (!file) {
      this.protocol.markMissing();
      this.report('missing', 'Linked C# file is no longer in the workspace');
      return;
    }
    this.protocol.designChanged(designerSourceDocument(this.view.document.value), { designRevision: this.view.document.revision, origin: event.kind });
    if (file.text !== this.protocol.source.text) this.protocol.sourceChanged(file.text, { sourceVersion: file.version });
    clearTimeout(this.designTimer);
    if (this.protocol.sourceDirty) {
      this.report('conflict', 'C# and design both changed. Both versions are retained for reconciliation.');
      return;
    }
    if (this.session.analysis.canApply === false) {
      this.report('blocked', firstSourceError(this.session.analysis.diagnostics ?? [])?.message ??
        'This preview cannot apply source in the current compiler target',
        this.session.analysis.diagnostics ?? []);
      return;
    }
    if (!this.dirty()) { this.report('synced', 'C# and design are synchronized.', []); return; }
    this.report('design-dirty', 'Designer changes staged · validating C# before writeback', []);
    if (this.auto) this.designTimer = setTimeout(() => this.write().catch(error => this.reportOperationError(error)), 350);
  }

  setAuto(enabled) {
    this.auto = !!enabled;
    clearTimeout(this.sourceTimer);
    clearTimeout(this.designTimer);
    if (this.auto && this.session) {
      if (this.file()?.text !== this.session.analysis.text) this.sourceChanged(this.file()?.uri);
      else if (this.dirty()) this.designChanged({ kind: 'edit' });
    }
    this.view.chrome?.renderSync();
    return this.auto;
  }

  sourceChanged(uri, {external = false, dependency = false} = {}) {
    if (!this.session || !this.protocol || !dependency && uri !== this.session.analysis.uri || this.writing) return;
    const file = this.file();
    if (!file) { this.protocol.markMissing(); this.report('missing', 'Linked C# file was removed'); return; }
    if (!external && !dependency && file.text === this.protocol.source.text && file.version === this.protocol.source.version) return;
    this.operation?.abort();
    if (external || dependency || (file.version ?? 0) < this.protocol.source.version) {
      this.generation++;
      this.protocol.replaceSource(file.text, { sourceVersion: file.version ?? 0 });
    } else this.protocol.sourceChanged(file.text, { sourceVersion: file.version });
    clearTimeout(this.sourceTimer);
    if (this.dirty()) { this.report('conflict', 'C# and designer both changed; automatic synchronization is paused.'); return; }
    this.report('source-dirty', 'C# changed · retaining the last valid preview', []);
    if (this.auto) this.sourceTimer = setTimeout(() => this.read().catch(error => this.reportOperationError(error)), 450);
  }

  async read({ discardDesign = false } = {}) {
    if (!this.session || !this.protocol) throw new Error('Connect a C# file first');
    if (this.writing) throw new Error('Wait for the pending source update');
    const file = this.file();
    if (!file) throw new Error('Linked C# file was removed');
    if (file.text !== this.protocol.source.text) this.protocol.sourceChanged(file.text, { sourceVersion: file.version });
    this.operation?.abort();
    const operation = new AbortController();
    this.operation = operation;
    const protocol = this.protocol;
    const token = protocol.begin('source', { resolution: discardDesign ? 'source' : null, signal: operation.signal });
    const version = file.version;
    let candidate;
    try { candidate = await this.analyze(file, this.session.analysis, {signal: operation.signal}); }
    catch (error) { protocol.reject(token, error); throw error; }
    if (file.version !== version || !protocol.isCurrent(token) || protocol !== this.protocol) return this.snapshot();
    if (candidate.workspaceRevision !== undefined && candidate.workspaceRevision !== this.view.state.revision) return this.snapshot();
    if (candidate.success === false && !candidate.previewAvailable) {
      const diagnostics = candidate.diagnostics ?? [];
      const diagnostic = firstSourceError(diagnostics);
      protocol.reject(token, diagnostic ?? {message: 'Source analysis did not produce a valid design'});
      this.report('blocked', diagnostic?.message ?? 'Retaining the last valid preview', diagnostics);
      return this.snapshot();
    }
    const document = candidate.analysis.document;
    const accept = candidate.success === false ? protocol.acceptPreview.bind(protocol) : protocol.accept.bind(protocol);
    const accepted = accept(token, {
      document: designerSourceDocument(document), sourceVersion: version, designRevision: this.view.document.revision + 1,
      diagnostics: candidate.diagnostics ?? [], success: candidate.success !== false,
      capability: candidate.analysis.previewCapability
    });
    if (!accepted.accepted) return this.snapshot();
    this.session = {analysis: candidate.analysis, sources: (this.view.sourceFiles?.() ?? []).map(item => ({...item}))};
    this.session.analysis.text ??= file.text;
    this.loading = true;
    try {
      this.view.document.load(retainDesignerRuntimeBindings(this.view.document.value, document), {label: 'source sync', history: false});
      setSourceAuthoringCapability(this, candidate.analysis);
    }
    finally { this.loading = false; }
    if (candidate.success === false) this.report('blocked', firstSourceError(candidate.diagnostics ?? [])?.message ??
      'Preview requires another compilation target',
      candidate.diagnostics ?? []);
    else this.report('synced', 'Read ' + file.uri + ' · last valid preview updated', []);
    publishSourceCatalog(this, candidate, candidate.revision ?? candidate.workspaceRevision ?? this.view.state.revision);
    return this.snapshot();
  }

  async write() {
    if (!this.session || !this.protocol) throw new Error('Connect a C# file first');
    this.assertCanApply();
    if (this.writing) return this.pending;
    const file = this.file();
    if (!file) throw new Error('Linked C# file was removed');
    if (this.view.state.readOnly) throw new Error('Begin Edit and Continue or stop debugging before changing C#');
    this.protocol.designChanged(designerSourceDocument(this.view.document.value), { designRevision: this.view.document.revision, origin: 'design' });
    if (file.text !== this.protocol.source.text) this.protocol.sourceChanged(file.text, { sourceVersion: file.version });
    const operation = new AbortController();
    this.operation?.abort();
    this.operation = operation;
    const token = this.protocol.begin('design', { signal: operation.signal });
    const generation = this.generation;
    const baseline = this.session;
    const design = designerSourceDocument(this.view.document.value);
    const version = file.version;
    this.writing = true;
    this.report('validating', 'Compile-checking the complete design transaction…', []);
    this.pending = this.applyPlan({file, baseline, design, token, generation, version, signal: operation.signal});
    try { return await this.pending; }
    finally { this.writing = false; this.pending = null; this.view.chrome?.refreshSource(); }
  }

  async applyPlan({file, baseline, design, token, generation, version, signal}) {
    const protocol = this.protocol;
    try {
      const plan = this.view.analyzeDesign
        ? await this.view.analyzeDesign({
          operation: 'plan', uri: file.uri, baselineSources: baseline.sources,
          previous: baseline.analysis, design, generation, signal, workspaceId: this.view.workspaceId?.()
        })
        : new CSharpDesignSession(baseline.analysis.text, { uri: file.uri }).plan(design, file.text);
      if (plan.success === false) throw Object.assign(new Error(plan.diagnostics?.[0]?.message ?? 'Designer changes do not compile'), {
        diagnostics: plan.diagnostics ?? []
      });
      const assertCurrent = () => {
        if (generation !== this.generation || baseline !== this.session || !protocol.isCurrent(token)) {
          throw new Error('Designer changed during compilation; retry the latest edit.');
        }
      };
      assertCurrent();
      if (plan.edits?.length || plan.changes?.some(change => change.edits.length)) {
        await this.view.applySourceEdits(file.uri, plan, version, assertCurrent);
      }
      assertCurrent();
      const current = this.file();
      const normalized = retainDesignerRuntimeBindings(this.view.document.value, plan.document ?? plan.analysis?.document ?? design);
      const needsLoad = JSON.stringify(normalized) !== JSON.stringify(this.view.document.value);
      const accepted = protocol.accept(token, {
        document: designerSourceDocument(normalized), text: current.text, sourceVersion: current.version,
        designRevision: this.view.document.revision + (needsLoad ? 1 : 0), diagnostics: plan.diagnostics ?? []
      });
      if (!accepted.accepted) throw new Error(accepted.diagnostic?.message ?? 'Source transaction became stale');
      this.session = {
        analysis: {...(plan.analysis ?? baseline.analysis), text: current.text, document: normalized},
        sources: (this.view.sourceFiles?.() ?? []).map(item => ({...item}))
      };
      if (needsLoad) {
        this.loading = true;
        try { this.view.document.load(normalized, {label: 'source sync', history: false}); }
        finally { this.loading = false; }
      }
      const count = plan.changes?.reduce((sum, change) => sum + change.edits.length, 0) ?? plan.edits?.length ?? 0;
      this.report('synced', 'Applied ' + count + ' source edits', []);
      return this.snapshot();
    } catch (error) {
      protocol.reject(token, { code: error.code ?? 'SFSYNC_BLOCKED', message: error.message });
      if (generation === this.generation && !signal?.aborted) this.reportOperationError(error);
      throw error;
    }
  }

  /** Restore a previously qualified source/design pair after an atomic editor undo or redo. */
  restoreHistory(analysis) {
    if (!analysis || !this.session) return;
    this.generation++;
    this.cancelPending();
    this.protocol?.dispose();
    const file = this.file();
    if (!file) throw new Error('Cannot restore history for a removed source file');
    this.session = {analysis: {...analysis, text: file.text},
      sources: (this.view.sourceFiles?.() ?? []).map(item => ({...item}))};
    this.loading = true;
    try {
      this.view.document.load(retainDesignerRuntimeBindings(this.view.document.value, analysis.document), {
        label: 'source sync', history: false
      });
      setSourceAuthoringCapability(this, analysis);
    }
    finally { this.loading = false; }
    this.protocol = new DesignSyncProtocol({
      workspaceId: this.view.workspaceId?.() ?? this.view.state.name ?? 'workspace', uri: file.uri,
      sourceText: file.text, sourceVersion: file.version, document: designerSourceDocument(this.view.document.value),
      designRevision: this.view.document.revision, generation: this.generation
    });
    markSourcePreviewBaseline(this, analysis);
    if (analysis.compilationSucceeded === false) {
      this.report('blocked', analysis.previewCapability?.reason ?? 'Source preview history restored with compiler limitations', analysis.diagnostics ?? []);
    } else this.report('synced', 'Source and design history restored together', []);
  }

  async editText(text) {
    const file = this.file();
    if (!file) throw new Error('Connect a source file first');
    if (this.dirty()) throw new Error('Apply or discard staged designer changes before editing linked C#');
    this.view.editSourceText(file.uri, text, file.version);
    this.sourceChanged(file.uri);
  }

  async action(action) {
    const actions = {
      connect: () => this.connect(), disconnect: () => this.disconnect(), write: () => this.write(),
      source: () => { const file = this.file(); return file ? this.view.openSource(file.uri) : this.connect(); },
      read: () => {
        const discard = this.dirty();
        if (discard && !globalThis.confirm('Discard staged design edits and reload the current C# construction method?')) return;
        return this.read({ discardDesign: discard });
      }
    };
    if (!actions[action]) throw new Error('Unknown synchronization command ' + action);
    return actions[action]();
  }

  renderControls() { return renderSourceSyncControls(this.snapshot()); }
  bindControls(root) { return bindSourceSyncControls(root, this); }

  dispose() {
    if (this.disposed) return;
    this.disconnect();
    this.disposed = true;
  }
}
