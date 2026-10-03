import {DesignerSourceSync} from './designer-source-sync.js';

/** Shares URI, conflict and history behavior with visual documents; resource classes remain explicit native-target previews. */
export class DesignerResourceSourceSync extends DesignerSourceSync {
  async analyze(file, _previous = null, {signal} = {}) {
    const workspaceRevision = this.view.state.revision;
    const response = await this.view.compiler.request('designResourceAnalyze', {
      operation: 'analyze', uri: file.uri, files: this.view.sourceFiles(), generation: this.generation
    }, {signal});
    if (!response.success) return {...response, workspaceRevision};
    const analysis = {...response.analysis, handlers: [], bindings: {}, structuralEditable: false};
    analysis.readOnly = false;
    analysis.previewCapability = {kind: 'resources', previewAvailable: analysis.previewReady === true,
      readOnly: false, stageDesign: true, sourceWrites: false};
    return {...response, workspaceRevision, success: false, previewAvailable: analysis.previewReady, analysis,
      diagnostics: analysis.diagnostics, projectTypes: []};
  }

  install() {
    if (this.exportButton || !this.view.chrome.commandBar) return;
    const button = this.view.stage.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = 'Export staged resource C#';
    button.title = 'Export the guarded source candidate for a native WinUI project';
    button.dataset.resourceSourceExport = '';
    button.onclick = () => this.view.safe(async () => {
      const plan = await this.planCandidate();
      this.view.download(this.view.session.uri.split('/').at(-1), plan.text, 'text/plain');
    });
    this.view.chrome.commandBar.add(button);
    this.exportButton = button;
  }

  async planCandidate() {
    if (!this.session) throw new Error('Open a resource class first');
    const files = this.view.sourceFiles();
    const revision = this.view.document.revision;
    const workspaceRevision = this.view.state.revision;
    const generation = this.generation;
    const response = await this.view.compiler.request('designResourceAnalyze', {
      operation: 'plan', uri: this.session.analysis.uri, files, baselineSources: this.session.sources,
      document: this.view.document.snapshot(), className: this.session.analysis.className, generation
    });
    if (generation !== this.generation || revision !== this.view.document.revision ||
      workspaceRevision !== this.view.state.revision || this.disposed) {
      throw new Error('The resource document changed while planning its export; retry the current document');
    }
    if (!response.success) throw Object.assign(new Error(response.diagnostics?.[0]?.message ?? 'Resource export could not be planned'), {
      diagnostics: response.diagnostics ?? []
    });
    return response.plan;
  }

  async write() {
    const plan = await this.planCandidate();
    if (plan.noOp) return this.snapshot();
    const diagnostic = plan.diagnostics.find(item => item.code === 'SFD1884');
    const message = diagnostic?.message ?? 'Resource source requires native WinUI compilation before applying changes';
    this.report('blocked', message, plan.diagnostics);
    throw Object.assign(new Error(message), {code: 'SFD1884', diagnostics: plan.diagnostics});
  }

  dispose() { this.exportButton?.remove(); super.dispose(); }
}
