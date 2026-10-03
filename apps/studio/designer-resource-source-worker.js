import {analyzeDesignerResourceSources, planDesignerResourceSourceUpdate, probeDesignerResourceSource} from '@sharpforge/designer';

/** Additive compiler-worker seam. A preview-ready resource analysis never implies a successful native compilation. */
export function registerDesignerResourceSourceWorker(protocol) {
  return protocol.registerHandler('designResourceAnalyze', params => {
    try {
      const options = {uri: params.uri, className: params.className};
      if (params.operation === 'probe') {
        const file = params.files.find(source => source.uri === params.uri);
        return {success: true, probe: probeDesignerResourceSource(file?.text, params.uri), generation: params.generation};
      }
      if (params.operation === 'plan') {
        const baseline = analyzeDesignerResourceSources(params.baselineSources, options);
        const plan = planDesignerResourceSourceUpdate(baseline, params.document, params.files, options);
        return {success: true, plan, generation: params.generation};
      }
      if (params.operation && params.operation !== 'analyze') throw new TypeError('Unknown resource designer worker operation.');
      const analysis = analyzeDesignerResourceSources(params.files, options);
      return {success: true, analysis, generation: params.generation};
    } catch (error) {
      return {success: false, generation: params.generation, diagnostics: [error.diagnostic ?? {
        code: 'SFD1880', severity: 'error', source: 'Designer', uri: params.uri, message: error.message
      }]};
    }
  });
}
