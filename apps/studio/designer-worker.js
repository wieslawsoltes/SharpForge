import {
  analyzeDesignSources, designSourceSnapshot, designSourceDiagnostic,
  planDesignSourceUpdate, planDesignEventHandler
} from '@sharpforge/designer';
import { frameworkAssignable, CONTROLS } from '@sharpforge/framework';
import { registerDesignerValidation } from './designer-worker-validation.js';

function sameSources(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const files = new Map(left.map(file => [file.uri, file]));
  return right.every(file => files.get(file.uri)?.text === file.text && files.get(file.uri)?.version === file.version);
}

function projectControls(analysis) {
  const types = [];
  for (const parsed of analysis.context?.parsedFiles ?? []) {
    for (const declaration of parsed.root.members) {
      if (declaration.kind !== 'Class') continue;
      const symbol = analysis.context.model.getDeclaredSymbol(declaration);
      const legacy = symbol?.legacy;
      const base = legacy?.baseType?.name ?? legacy?.baseType ?? legacy?.baseName;
      if (typeof base !== 'string' || !frameworkAssignable(CONTROLS + 'UserControl', base)) continue;
      const type = [declaration.namespace, declaration.name].filter(Boolean).join('.');
      types.push({ type, baseType: CONTROLS + 'UserControl', uri: parsed.source.uri, analysisVersion: parsed.source.version });
    }
  }
  return types;
}

/** Register an additive compiler-worker request; syntax and semantic graphs remain in the worker. */
export function registerDesignerWorker(protocol, { maxCachedDocuments = 32, workspace = null } = {}) {
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
    while (analyses.size > maxCachedDocuments) analyses.delete(analyses.keys().next().value);
  };
  const baseline = params => {
    const cached = analyses.get(params.uri);
    if (cached && sameSources(cached.sources, params.baselineSources)) return cached;
    return analyzeDesignSources(params.baselineSources, options(params));
  };
  const serializePlan = plan => ({
    success: plan.compilationSucceeded !== false,
    text: plan.text, edits: plan.edits, changes: plan.changes, expectedSources: plan.expectedSources,
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
      return { success, analysis: snapshot, diagnostics, projectTypes: projectControls(analysis), generation: params.generation };
    },
    plan(params) {
      const analysis = baseline(params);
      const plan = planDesignSourceUpdate(analysis, params.design, params.files, { requireCompilation: true });
      retain(plan.analysis);
      return serializePlan(plan);
    },
    event(params) {
      const analysis = baseline(params);
      const plan = planDesignEventHandler(analysis, params.nodeId, params.event, params.options ?? {});
      if (plan.navigation) return { success: true, navigation: plan.navigation };
      return serializePlan(plan);
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
