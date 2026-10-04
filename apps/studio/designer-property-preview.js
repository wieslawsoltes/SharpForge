import {DesignerAuthoringError, designScene, projectDesignerAuthoringScene, referencedDesignerAssets} from '../../packages/designer/src/index.js';
import {designerAssetReferenceScene} from './designer-property-asset-references.js';
import {isDesignerResourceDocument} from './designer-resource-context.js';

/** Loads images referenced by an opened design through the same authorized store used by the picker. */
export class DesignerAssetPreviewController {
  constructor(view, {basePath = '', onError = error => view.error(error)} = {}) {
    this.view = view;
    this.basePath = basePath;
    this.onError = onError;
    this.generation = 0;
    this.version = 0;
    this.disposed = false;
    this.diagnostics = [];
    this.reported = new Set();
  }

  async refresh() {
    if (this.disposed) return {loaded: 0, diagnostics: [], stale: true};
    const generation = ++this.generation;
    const document = this.view.document;
    const revision = document.revision;
    const store = this.view.assetPreviews;
    const scene = isDesignerResourceDocument(this.view) ? null : this.view.buildPreviewScene?.() ??
      projectDesignerAuthoringScene(document.value, designScene(document.value));
    const references = designerAssetReferenceScene(document.value, scene);
    const pending = referencedDesignerAssets(references, this.view.records(), {basePath: this.basePath, resolveAsset: uri => store?.resolve(uri)});
    let outcomes = [];
    if (pending.assets.length) {
      if (store) outcomes = await Promise.allSettled(pending.assets.map(asset => store.preview(asset)));
      else pending.diagnostics.push({code: 'SFD1863', severity: 'error', span: null, message: 'Project asset preview service is unavailable.'});
    }
    if (this.disposed || generation !== this.generation || document !== this.view.document || revision !== document.revision) {
      return {loaded: 0, diagnostics: [], stale: true};
    }
    let loaded = 0;
    for (const result of outcomes) {
      if (result.status === 'fulfilled') loaded++;
      else pending.diagnostics.push(result.reason.diagnostic ?? {code: 'SFD1863', severity: 'error', span: null, message: result.reason.message});
    }
    this.diagnostics = pending.diagnostics;
    const reported = new Set();
    for (const diagnostic of this.diagnostics) {
      const key = diagnostic.nodeId + ':' + diagnostic.message;
      reported.add(key);
      if (this.reported.has(key)) continue;
      this.onError(new DesignerAuthoringError(diagnostic.code, diagnostic.message, diagnostic));
    }
    this.reported = reported;
    if (loaded) {
      this.version++;
      this.view.updatePreview();
      this.view.resources?.refreshPreviews?.();
    }
    return {loaded, diagnostics: this.diagnostics, stale: false};
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.reported.clear();
  }
}
