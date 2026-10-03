import {
  analyzeDesignSources, designSourceSnapshot, designPreviewCapability,
  designComposedPreviewCapability, designInheritancePreviewProfile, designProtectedEventPreviewCapability
} from '@sharpforge/designer';
import {designerAnalysisOptions} from './designer-worker-cache.js';
import {analyzeDesignerProjectCatalog, assertDesignerProjectTypes} from './designer-worker-catalog.js';

/** Build a serializable preview result without converting a failed C# compilation into success. */
export function analyzeDesignerWorkerSources(params) {
  let analysis = analyzeDesignSources(params.files, designerAnalysisOptions(params));
  let projectTypes;
  let preview = designPreviewCapability(analysis);
  let previewDiagnostics = [];
  if (!analysis.compilationSucceeded && designInheritancePreviewProfile(analysis.compilerDiagnostics)) {
    const catalog = analyzeDesignerProjectCatalog(params, analysis);
    projectTypes = catalog.projectTypes;
    previewDiagnostics = catalog.previewDiagnostics;
    analysis = analyzeDesignSources(params.files, {...designerAnalysisOptions(params), projectTypes, reuseAnalysis: analysis});
    preview = designPreviewCapability(analysis);
    if (!preview.previewAvailable) preview = designComposedPreviewCapability(analysis, [...catalog.analyses.values()]);
  } else {
    projectTypes = assertDesignerProjectTypes(analysis, analysis.document, params.revision ?? 0) ?? [];
    if (!preview.previewAvailable) preview = designProtectedEventPreviewCapability(analysis);
  }
  const snapshot = designSourceSnapshot(analysis);
  const diagnostics = snapshot.diagnostics;
  if (!analysis.compilationSucceeded && !preview.previewAvailable && designInheritancePreviewProfile(analysis.compilerDiagnostics)) {
    diagnostics.push({code: 'SFD1862', severity: 'warning', source: 'Designer', uri: analysis.uri, message: preview.reason});
  }
  const success = analysis.compilationSucceeded && !diagnostics.some(item => item.severity === 'error');
  snapshot.canApply = success;
  snapshot.readOnly = !success && preview.previewAvailable;
  snapshot.previewCapability = preview;
  const result = {success, previewAvailable: !success && preview.previewAvailable, readOnly: snapshot.readOnly,
    analysis: snapshot, diagnostics, projectTypes, previewDiagnostics, generation: params.generation, revision: params.revision};
  return {analysis, result};
}
