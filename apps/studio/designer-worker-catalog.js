import {compileToIL} from '@sharpforge/compiler';
import {
  analyzeDesignSources, designPreviewCapability, designInheritancePreviewProfile,
  discoverProjectControls, discoverPreviewProjectControls, projectControlCandidates, DesignSyncError
} from '@sharpforge/designer';
import {designerAnalysisOptions} from './designer-worker-cache.js';

function componentDiagnostic(candidate, message) {
  return {code: 'SFD1862', severity: 'warning', source: 'Designer', uri: candidate.uri, message};
}

function analyzeProjectComponent(params, options, candidate, reusable) {
  const request = {...options, uri: candidate.uri, className: candidate.type, previous: undefined,
    projectTypes: undefined, reuseAnalysis: reusable};
  try {
    return analyzeDesignSources(params.files, {...request, methodName: 'InitializeComponent'});
  } catch (error) {
    if (error.code !== 'SFSYNC_SYMBOL') throw error;
    return analyzeDesignSources(params.files, {...request, methodName: '.ctor'});
  }
}

/** Caller metadata cannot turn an unrelated compiled class into a visual control. */
export function assertDesignerProjectTypes(analysis, document = analysis.document, revision = 0) {
  if (!analysis.compilationSucceeded) return;
  const current = discoverProjectControls({success: true, files: analysis.sources, version: revision});
  const known = new Map(current.map(descriptor => [descriptor.type, descriptor]));
  const declared = new Map((document.projectTypes ?? []).map(descriptor => [descriptor.type, descriptor]));
  for (const node of document.nodes) {
    if (!node.projectType) continue;
    const descriptor = known.get(node.projectType);
    const requested = declared.get(node.projectType);
    if (!descriptor || descriptor.baseType !== node.type || requested?.previewOnly
      || requested?.uri && requested.uri !== descriptor.uri) {
      throw new DesignSyncError(`Project control '${node.projectType}' does not match the current compiled source catalog.`,
        'SFSYNC_OWNERSHIP', analysis.bindings[node.id]?.declaration, {uri: analysis.uri});
    }
  }
  return current;
}

/** Failed compilation may produce a distinct preview catalog only from individually proven source constructions. */
export function analyzeDesignerProjectCatalog(params, seed = null) {
  const options = designerAnalysisOptions(params);
  const candidates = projectControlCandidates(params.files);
  const analyses = new Map();
  const diagnostics = [];
  let reusable = seed;
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.type)) continue;
    seen.add(candidate.type);
    if (seen.size > 256) throw new RangeError('Project component preview count exceeds 256.');
    try {
      const analysis = analyzeProjectComponent(params, options, candidate, reusable);
      reusable ??= analysis;
      const capability = designPreviewCapability(analysis);
      if (capability.previewAvailable) analyses.set(candidate.type, analysis);
      else diagnostics.push(componentDiagnostic(candidate, capability.reason));
    } catch (error) {
      diagnostics.push(componentDiagnostic(candidate, error.message));
      if (error.code === 'SFSYNC_PARSE') break;
    }
  }
  const compilation = reusable ? {success: reusable.compilationSucceeded, diagnostics: reusable.compilerDiagnostics}
    : compileToIL(params.files, options.compilationOptions);
  if (compilation.success) {
    return {success: true, previewAvailable: false,
      projectTypes: discoverProjectControls({success: true, files: params.files, version: params.revision ?? 0}),
      diagnostics: compilation.diagnostics ?? [], previewDiagnostics: [], analyses};
  }
  if (!designInheritancePreviewProfile(compilation.diagnostics)) analyses.clear();
  const projectTypes = discoverPreviewProjectControls({success: false, previewAvailable: true,
    projectTypes: [...analyses.values()].map(analysis => designPreviewCapability(analysis).descriptor), version: params.revision ?? 0});
  return {success: false, previewAvailable: projectTypes.length > 0, projectTypes,
    diagnostics: compilation.diagnostics ?? [], previewDiagnostics: diagnostics, analyses};
}
