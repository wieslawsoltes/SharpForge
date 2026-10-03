import {DesignerResourceSourceError, renameDesignerResource} from '@sharpforge/designer';

function responseValue(response, key) {
  if (response.success && response[key]) return response[key];
  const diagnostic = response.diagnostics?.[0] ?? {code: 'SFD1880', message: 'The resource worker returned no analysis.'};
  throw new DesignerResourceSourceError(diagnostic.code, diagnostic.message, diagnostic);
}

const sameSources = (left, right) => left.length === right.length && left.every(file => right.some(candidate =>
  candidate.uri === file.uri && candidate.text === file.text && (candidate.version ?? 0) === (file.version ?? 0)));

/** Resource document host adapter. Request is the real compiler-worker channel; writes are explicitly unavailable. */
export class DesignerResourceSourceAdapter {
  constructor({uri, document, readSources, request, openSource = () => {}, publishDiagnostics = () => {}}) {
    if (typeof uri !== 'string' || !document?.load || typeof readSources !== 'function' || typeof request !== 'function') {
      throw new TypeError('Resource source adapters require a URI, design document, source reader and worker request.');
    }
    Object.assign(this, {uri, document, readSources, request, openSource, publishDiagnostics});
    this.analysis = null;
    this.generation = 0;
    this.disposed = false;
    this.loading = false;
    this.state = 'unlinked';
    this.listeners = new Set();
    this.unsubscribe = document.subscribe(() => {
      if (!this.loading && this.analysis) {
        this.state = this.dirty() ? 'design-dirty' : 'preview-only';
        this.emit();
      }
    });
  }

  assertActive() {
    if (this.disposed) throw new DesignerResourceSourceError('SFD1886', 'The resource document was closed.', {uri: this.uri});
  }

  get session() { return this.analysis ? {analysis: this.analysis} : null; }
  dirty() { return !!this.analysis && JSON.stringify(this.document.value) !== JSON.stringify(this.analysis.document); }
  subscribe(listener) { this.assertActive(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(this.snapshot()); }

  async analyze({discard = false} = {}) {
    this.assertActive();
    const files = this.readSources().map(file => ({...file}));
    if (this.dirty() && !discard) {
      if (sameSources(this.analysis.sources, files)) return this.analysis;
      this.state = 'conflict';
      this.emit();
      throw new DesignerResourceSourceError('SFD1882', 'External source changed while resource edits were staged. Both versions are retained.',
        {uri: this.uri});
    }
    const generation = ++this.generation;
    try {
      const response = await this.request('designResourceAnalyze', {uri: this.uri, files, generation});
      if (this.disposed || generation !== this.generation) return null;
      if (!sameSources(files, this.readSources())) throw new DesignerResourceSourceError('SFD1882',
        'Resource source changed during analysis; the previous preview was retained.', {uri: this.uri});
      const analysis = responseValue(response, 'analysis');
      this.loading = true;
      try { this.document.load(analysis.document, {label: 'Read resource source'}); }
      finally { this.loading = false; }
      this.analysis = analysis;
      this.state = 'preview-only';
      this.publishDiagnostics(this.uri, analysis.diagnostics);
      this.emit();
      return analysis;
    } catch (error) {
      if (this.disposed || generation !== this.generation) return null;
      this.state = error.code === 'SFD1882' ? 'conflict' : 'blocked';
      this.publishDiagnostics(this.uri, [error.diagnostic ?? {code: 'SFD1880', message: error.message, severity: 'error', uri: this.uri}]);
      this.emit();
      throw error;
    }
  }

  connect() { return this.analyze(); }
  rename(key, nextKey) { this.assertActive(); return renameDesignerResource(this.document, key, nextKey); }

  async plan() {
    this.assertActive();
    if (!this.analysis) throw new DesignerResourceSourceError('SFD1880', 'Open a resource class first.', {uri: this.uri});
    const generation = this.generation;
    const revision = this.document.revision;
    const files = this.readSources().map(file => ({...file}));
    const response = await this.request('designResourceAnalyze', {operation: 'plan', uri: this.uri, files,
      baselineSources: this.analysis.sources, document: this.document.snapshot(), className: this.analysis.className, generation});
    this.assertActive();
    if (generation !== this.generation || revision !== this.document.revision || !sameSources(files, this.readSources())) {
      throw new DesignerResourceSourceError('SFD1882', 'Resource edits changed during planning; retry the current document.', {uri: this.uri});
    }
    const plan = responseValue(response, 'plan');
    this.publishDiagnostics(this.uri, plan.diagnostics);
    return plan;
  }

  async write() {
    const plan = await this.plan();
    if (plan.noOp) return plan;
    const diagnostic = plan.diagnostics.find(item => item.code === 'SFD1884');
    throw new DesignerResourceSourceError('SFD1884', diagnostic?.message ?? 'Native WinUI source qualification is unavailable.', diagnostic);
  }

  navigate() { this.assertActive(); return this.openSource(this.uri, this.analysis?.ownership.span.start ?? 0); }
  snapshot() {
    return {uri: this.uri, kind: 'resources', state: this.state, dirty: this.dirty(), canApply: false,
      previewReady: !!this.analysis, diagnostics: this.analysis?.diagnostics ?? [], generation: this.generation};
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.unsubscribe();
    this.listeners.clear();
  }
}

/** A same-document status bar exposes the useful export path without implying that source was compiled or written. */
export function mountDesignerResourceSourceStatus(parent, adapter, {exportCandidate} = {}) {
  const document = parent.ownerDocument;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const code = document.createElement('button');
  code.type = 'button';
  code.textContent = 'View resource C#';
  code.onclick = () => adapter.navigate();
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = 'Export staged resource C#';
  exportButton.disabled = typeof exportCandidate !== 'function';
  exportButton.onclick = async () => {
    try { await exportCandidate((await adapter.plan()).text); }
    catch (error) { status.textContent = error.message; }
  };
  const update = state => {
    status.textContent = state.dirty ? 'Resource changes are staged. Native WinUI compilation is required before applying source.'
      : 'Resource preview. Native WinUI compilation is unavailable; source is preserved.';
  };
  const unsubscribe = adapter.subscribe(update);
  update(adapter.snapshot());
  parent.append(status, code, exportButton);
  return () => { unsubscribe(); status.remove(); code.remove(); exportButton.remove(); };
}
