import {
  analyzeDesignSources, designSourceSnapshot, designSourceDiagnostic,
  planDesignSourceUpdate, planDesignEventHandler, DesignSyncError
} from '@sharpforge/designer';
import { registerDesignerValidation } from './designer-worker-validation.js';
import {registerDesignerResourceSourceWorker} from './designer-resource-source-worker.js';
import {DesignerWorkerAnalysisCache, designerAnalysisOptions, sameDesignerSources} from './designer-worker-cache.js';
import {analyzeDesignerProjectCatalog, assertDesignerProjectTypes} from './designer-worker-catalog.js';
import {DesignerWorkerQueue} from './designer-worker-queue.js';
import {analyzeDesignerWorkerSources} from './designer-worker-analysis.js';

/** Register an additive compiler-worker request; syntax and semantic graphs remain in the worker. */
export function registerDesignerWorker(protocol, {maxCachedDocuments = 4, maxCachedCharacters = 512000, workspace = null} = {}) {
  const unregisterValidation = workspace ? registerDesignerValidation(protocol, workspace) : null;
  const unregisterResources = registerDesignerResourceSourceWorker(protocol);
  const analyses = new DesignerWorkerAnalysisCache({maxDocuments: maxCachedDocuments, maxCharacters: maxCachedCharacters});
  const queue = new DesignerWorkerQueue();
  const baseline = params => {
    if (!sameDesignerSources(params.baselineSources, params.files)) {
      throw new DesignSyncError('Source versions, files or edit permissions changed after analysis.', 'SFSYNC_CONFLICT');
    }
    const analysis = analyses.get(params, params.baselineSources)
      ?? analyzeDesignSources(params.baselineSources, designerAnalysisOptions(params));
    assertDesignerProjectTypes(analysis, analysis.document, params.revision ?? 0);
    return analysis;
  };
  const serializePlan = plan => ({
    success: plan.compilationSucceeded !== false,
    compilationSucceeded: plan.compilationSucceeded,
    text: plan.text, edits: plan.edits, changes: plan.changes, sources: plan.sources, expectedSources: plan.expectedSources,
    document: plan.document, analysis: designSourceSnapshot(plan.analysis),
    structural: plan.structural, warnings: plan.warnings, diagnostics: plan.diagnostics ?? []
  });
  const operations = {
    analyze(params) {
      const {analysis, result} = analyzeDesignerWorkerSources(params);
      if (result.success || result.previewAvailable) analyses.set({...params, uri: analysis.uri,
        className: analysis.ownership.className, methodName: analysis.method.name, previous: result.analysis}, analysis);
      return result;
    },
    catalog(params) {
      const catalog = analyzeDesignerProjectCatalog(params);
      return {success: catalog.success, previewAvailable: catalog.previewAvailable, projectTypes: catalog.projectTypes,
        diagnostics: catalog.diagnostics, previewDiagnostics: catalog.previewDiagnostics, revision: params.revision};
    },
    plan(params) {
      const analysis = baseline(params);
      assertDesignerProjectTypes(analysis, params.design, params.revision ?? 0);
      const plan = planDesignSourceUpdate(analysis, params.design, params.files, {requireCompilation: true, signal: params.signal});
      analyses.set({...params, uri: plan.analysis.uri, className: plan.analysis.ownership.className,
        methodName: plan.analysis.method.name, previous: designSourceSnapshot(plan.analysis)}, plan.analysis);
      return serializePlan(plan);
    },
    event(params) {
      const analysis = baseline(params);
      if (params.navigateOnly && !analysis.bindings[params.nodeId]?.events?.[params.event]) {
        throw new Error('This event does not have a source handler');
      }
      const plan = planDesignEventHandler(analysis, params.nodeId, params.event, {
        ...params.options, currentSources: params.files, requireCompilation: true, signal: params.signal
      });
      return {...serializePlan(plan), navigation: plan.navigation, existing: plan.existing,
        navigationAvailable: !!params.navigateOnly && !!plan.existing && !plan.changes.length,
        readOnly: plan.readOnly || plan.compilationSucceeded === false, handler: plan.handler};
    }
  };
  const unregister = protocol.registerHandler('designAnalyze', async (params, _method, context = {}) => {
    try {
      const operation = operations[params.operation ?? 'analyze'];
      if (!operation || !Object.hasOwn(operations, params.operation ?? 'analyze')) throw new TypeError('Unknown designer worker operation');
      return await queue.run(params, context, operation);
    } catch (error) {
      return { success: false, generation: params.generation,
        diagnostics: error.details?.diagnostics ?? [designSourceDiagnostic(error, { uri: params.uri })] };
    }
  });
  return () => { queue.dispose(); unregister(); unregisterResources(); unregisterValidation?.(); analyses.clear(); };
}
