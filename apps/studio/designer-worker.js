import {
  analyzeDesignSources, designSourceSnapshot, designSourceDiagnostic,
  planDesignSourceUpdate, planDesignEventHandler, discoverProjectControls
} from '@sharpforge/designer';
import { registerDesignerValidation } from './designer-worker-validation.js';

function sameSources(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const files = new Map(left.map(file => [file.uri, file]));
  if (files.size !== left.length || new Set(right.map(file => file.uri)).size !== right.length) return false;
  return right.every(file => files.get(file.uri)?.text === file.text && files.get(file.uri)?.version === file.version);
}

/** Register an additive compiler-worker request; syntax and semantic graphs remain in the worker. */
export function registerDesignerWorker(protocol, {maxCachedDocuments = 4, maxCachedCharacters = 512000, workspace = null} = {}) {
  const unregisterValidation = workspace ? registerDesignerValidation(protocol, workspace) : null;
  const analyses = new Map();
  const options = params => ({
    uri: params.uri, previous: params.previous,
    projectTypes: params.projectTypes ?? params.previous?.document?.projectTypes,
    compilationOptions: { ...params.compilationOptions, outputKind: 'library' }
  });
  const retain = analysis => {
    analyses.delete(analysis.uri);
    analyses.set(analysis.uri, analysis);
    const size = item => item.sources.reduce((sum, file) => sum + file.text.length, 0);
    let characters = [...analyses.values()].reduce((sum, item) => sum + size(item), 0);
    while (analyses.size && (analyses.size > maxCachedDocuments || characters > maxCachedCharacters)) {
      const oldest = analyses.keys().next().value;
      characters -= size(analyses.get(oldest));
      analyses.delete(oldest);
    }
  };
  const baseline = params => {
    const cached = analyses.get(params.uri);
    if (cached && sameSources(cached.sources, params.baselineSources)) return cached;
    return analyzeDesignSources(params.baselineSources, options(params));
  };
  const serializePlan = plan => ({
    success: plan.compilationSucceeded !== false,
    text: plan.text, edits: plan.edits, changes: plan.changes, sources: plan.sources, expectedSources: plan.expectedSources,
    document: plan.document, analysis: designSourceSnapshot(plan.analysis),
    structural: plan.structural, warnings: plan.warnings, diagnostics: plan.diagnostics ?? []
  });
  const operations = {
    analyze(params) {
      const analysis = analyzeDesignSources(params.files, options(params));
      const snapshot = designSourceSnapshot(analysis);
      const diagnostics = snapshot.diagnostics ?? [];
      const success = !diagnostics.some(item => item.severity === 'error');
      if (success) retain(analysis);
      const projectTypes = discoverProjectControls({success: analysis.compilationSucceeded, files: analysis.sources, version: params.revision});
      return {success, analysis: snapshot, diagnostics, projectTypes, generation: params.generation};
    },
    catalog(params) {
      const projectTypes = discoverProjectControls({success: params.success, files: params.files, version: params.revision});
      return {success: params.success, projectTypes, revision: params.revision};
    },
    plan(params) {
      const analysis = baseline(params);
      const plan = planDesignSourceUpdate(analysis, params.design, params.files, { requireCompilation: true });
      retain(plan.analysis);
      return serializePlan(plan);
    },
    event(params) {
      const analysis = baseline(params);
      if (params.navigateOnly && !analysis.bindings[params.nodeId]?.events?.[params.event]) {
        throw new Error('This event does not have a source handler');
      }
      const plan = planDesignEventHandler(analysis, params.nodeId, params.event, {
        ...params.options, currentSources: params.files, requireCompilation: true
      });
      return {...serializePlan(plan), navigation: plan.navigation, existing: plan.existing,
        readOnly: plan.readOnly, handler: plan.handler};
    }
  };
  const unregister = protocol.registerHandler('designAnalyze', params => {
    try {
      const operation = operations[params.operation ?? 'analyze'];
      if (!operation || !Object.hasOwn(operations, params.operation ?? 'analyze')) throw new TypeError('Unknown designer worker operation');
      return operation(params);
    } catch (error) {
      return { success: false, generation: params.generation,
        diagnostics: error.details?.diagnostics ?? [designSourceDiagnostic(error, { uri: params.uri })] };
    }
  });
  return () => { unregister(); unregisterValidation?.(); analyses.clear(); };
}
