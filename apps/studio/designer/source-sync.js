import { designSourceFormat, designSourceFormats } from '../../../packages/designer/src/index.js';
import { sourceSyncControls } from './source-controls.js';
import { openDesignerSource } from './source-editor.js';
import { captureDesignerTarget, reportDesignerError, reportDesignerSync, scheduleDesignerSync } from '../designer-diagnostics.js';

/** Coordinates source and design baselines. Each registered format owns parsing, validation and write dispatch. */
export class DesignerSourceSync {
  constructor(view) {
    this.view = view;
    this.session = null;
    this.format = null;
    this.auto = true;
    this.state = 'unlinked';
    this.message = 'Connect a C# construction method or XAML view to edit source and design together.';
    this.sourceTimer = null;
    this.designTimer = null;
    this.writing = false;
    this.loading = false;
    this.generation = 0;
    this.diagnosticTarget = null;
  }

  files(opened = this.view.sourceFiles?.() ?? []) {
    const files = new Map(opened.map(file => [file.uri, file]));
    for (const record of this.view.records?.() ?? []) {
      const uri = record.uri ?? record.path;
      if (typeof record.text !== 'string' || !designSourceFormats.some(format => format.matches(uri)) || files.has(uri)) continue;
      files.set(uri, { ...record, uri, version: record.version ?? this.view.state.revision });
    }
    return [...files.values()].filter(file => designSourceFormats.some(format => format.matches(file.uri)));
  }

  file() { return this.files().find(file => file.uri === this.session?.analysis.uri); }
  dirty() { return !!this.session && JSON.stringify(this.view.document.value) !== JSON.stringify(this.session.analysis.document); }

  snapshot() {
    return { uri: this.session?.analysis.uri ?? null, method: this.session?.analysis.method.name ?? null,
      format: this.format?.id ?? null, state: this.state, message: this.message, auto: this.auto, dirty: this.dirty(),
      warnings: this.session?.analysis.warnings ?? [], structuralEditable: this.session?.analysis.structuralEditable ?? false };
  }

  report(state, message, target) { return reportDesignerSync(this, state, message, target); }

  clearTimers() { clearTimeout(this.sourceTimer); clearTimeout(this.designTimer); }

  async connect(uri) {
    this.view.ensure();
    const generation = this.generation;
    const opened = this.view.sourceFiles?.() ?? [];
    const files = this.files(opened);
    if (!uri) {
      const active = files.find(file => file.uri === this.view.state.active);
      const preferred = files.find(file => /DesignedView.*\.cs$/.test(file.uri));
      uri = preferred?.uri ?? active?.uri;
      if (files.length > 1) uri = await this.view.choose('Connect designer source', files.map(file => file.uri), uri);
    }
    if (!uri) return null;
    const file = files.find(file => file.uri === uri);
    if (!file) throw new Error('Source file is not available in this workspace');
    const currentOpened = this.view.sourceFiles?.() ?? [];
    const current = this.files(currentOpened).find(candidate => candidate.uri === uri);
    // Open buffers have stable identities; closed records are fresh views over versioned workspace data.
    const replacedOpenFile = opened.includes(file) && currentOpened.find(candidate => candidate.uri === uri) !== file;
    if (generation !== this.generation || replacedOpenFile || !current ||
      current.version !== file.version || current.text !== file.text) {
      throw new Error('Source selection changed while choosing a view');
    }
    const target = captureDesignerTarget(this.view, uri);
    const format = designSourceFormat(uri);
    let session;
    try { session = new format.Session(file.text, { uri }); }
    catch (error) {
      if (target || typeof this.view.toast === 'function') reportDesignerError(this.view, error, target);
      throw error;
    }
    this.view.diagnostics?.clear(this.diagnosticTarget);
    this.generation++;
    this.clearTimers();
    this.session = session;
    this.format = format;
    this.loading = true;
    try { this.view.replace(session.document, { path: uri.replace(/(?:\.g)?\.(?:cs|xaml)$/i, '.sfdesign.json') }); }
    finally { this.loading = false; }
    this.report('synced', `Linked ${uri} · ${session.analysis.method.name} · ${session.analysis.warnings.length} protected expression(s)`, target);
    // Linking XAML must never open a modal or execute its code-behind.
    this.view.chrome?.setMode(format.viewMode);
    return this.snapshot();
  }

  disconnect() {
    this.generation++;
    this.session = null;
    this.format = null;
    this.clearTimers();
    this.report('unlinked', 'Source link disconnected; the design document is retained.');
  }

  designChanged(event) {
    if (!this.session || this.loading || ['selection', 'initialize', 'saved', 'source sync'].includes(event.kind)) return;
    if (!this.file()) { this.report('missing', 'Linked source file is no longer in the workspace'); return; }
    if (this.file().text !== this.session.analysis.text) {
      this.report('conflict', 'Both source and design changed. Read the source to discard staged design changes, or reconcile manually.');
      return;
    }
    if (!this.dirty()) { this.report('synced', 'Source and design are synchronized.'); return; }
    this.report('design-dirty', 'Designer changes staged · validating source before writeback');
    clearTimeout(this.designTimer);
    if (this.auto) this.designTimer = scheduleDesignerSync(this, 'write', 350);
  }

  setAuto(enabled) {
    this.auto = !!enabled;
    this.clearTimers();
    if (this.auto && this.session) {
      if (this.file()?.text !== this.session.analysis.text) this.sourceChanged(this.file()?.uri);
      else if (this.dirty()) this.designChanged({ kind: 'edit' });
    }
    this.view.chrome?.renderSync();
    return this.auto;
  }

  sourceChanged(uri) {
    if (!this.session || uri !== this.session.analysis.uri || this.writing) return;
    clearTimeout(this.sourceTimer);
    if (this.dirty()) { this.report('conflict', 'Source and designer both changed; automatic synchronization is paused.'); return; }
    this.report('source-dirty', 'Source changed · waiting for a complete view');
    if (this.auto) this.sourceTimer = scheduleDesignerSync(this, 'read', 450);
  }

  async read({ discardDesign = false } = {}) {
    if (!this.session) throw new Error('Connect a source file first');
    if (this.writing) throw new Error('Wait for the pending source update');
    if (this.dirty() && !discardDesign) throw new Error('Designer changes are staged. Confirm Read source to discard them.');
    const file = this.file();
    if (!file) throw new Error('Linked source file was removed');
    const generation = this.generation;
    const document = this.session.read(file.text);
    if (generation !== this.generation) throw new Error('Source link changed');
    const selection = [...this.view.document.selection];
    this.loading = true;
    try {
      this.view.replace(document, { path: this.view.path });
      this.view.document.select(selection.filter(id => document.nodes.some(node => node.id === id)));
    } finally { this.loading = false; }
    this.report('synced', `Read ${file.uri} · ${this.session.analysis.warnings.length} protected expression(s)`);
    return this.snapshot();
  }

  async write() {
    if (!this.session) throw new Error('Connect a source file first');
    if (this.writing) return this.pending;
    const file = this.file();
    if (!file) throw new Error('Linked source file was removed');
    if (this.view.state.readOnly) throw new Error('Begin Edit and Continue or stop debugging before changing source');
    const session = this.session;
    const epoch = this.generation;
    const revision = this.view.document.revision;
    const target = captureDesignerTarget(this.view, file.uri);
    const plan = session.plan(this.view.document.value, file.text);
    if (!plan.edits.length) { session.commit(plan); this.report('synced', 'Source and design are synchronized.'); return this.snapshot(); }
    const apply = this.view[this.format.writeService];
    if (typeof apply !== 'function') throw new Error('This host has no ' + this.format.label + ' source transaction service');
    this.writing = true;
    this.report('validating', `Validating ${plan.edits.length} source edit(s)…`, target);
    this.pending = (async () => {
      try {
        await apply.call(this.view, file.uri, plan, file.version, () => {
          if (epoch !== this.generation || session !== this.session || revision !== this.view.document.revision) {
            throw new Error('Designer changed during validation; retry the latest edit.');
          }
        });
        if (epoch !== this.generation || session !== this.session) throw new Error('Source link changed during source update');
        session.commit(plan);
        this.report('synced', `Applied ${plan.edits.length} source edit(s) · user handlers retained`);
        return this.snapshot();
      } catch (error) {
        if (epoch === this.generation && session === this.session) this.report('blocked', error.message, target);
        throw error;
      }
      finally { this.writing = false; this.pending = null; this.view.chrome?.refreshSource(); }
    })();
    return this.pending;
  }

  async editText(text, { uri, expectedVersion, expectedText } = {}) {
    const file = this.file();
    if (!file) throw new Error('Connect a source file first');
    if (uri && uri !== file.uri || expectedVersion !== undefined && file.version !== expectedVersion ||
      expectedText !== undefined && file.text !== expectedText) throw new Error('Source changed while the editor was open');
    if (this.dirty()) throw new Error('Apply or discard staged designer changes before editing linked source');
    const edit = this.view[this.format.editService];
    if (typeof edit !== 'function') throw new Error('This host has no ' + this.format.label + ' source edit service');
    await edit.call(this.view, file.uri, text, file.version);
    this.sourceChanged(file.uri);
  }

  async action(action) {
    if (action === 'connect') return this.connect();
    if (action === 'disconnect') return this.disconnect();
    if (action === 'write') return this.write();
    if (action === 'read') {
      const discard = this.dirty();
      if (discard && !globalThis.confirm('Discard staged design edits and reload the current source?')) return;
      return this.read({ discardDesign: discard });
    }
    if (action === 'source') return this.file() ? openDesignerSource(this.view, this.file().uri) : this.connect();
  }

  renderControls() { return sourceSyncControls(this); }

  bindControls(root) {
    root.querySelectorAll('[data-sync]').forEach(button => button.onclick = () => this.view.safe(() => this.action(button.dataset.sync)));
    const auto = root.querySelector('[data-sync-auto]');
    if (auto) auto.onchange = () => this.setAuto(auto.checked);
  }

  dispose() { this.disconnect(); this.clearTimers(); }
}
