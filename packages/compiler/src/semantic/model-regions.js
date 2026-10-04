/**
 * Region queries of the semantic model over the semantic analysis (SF-A02-T38, SF-A02-T35): the data-flow and
 * control-flow facts a refactoring asks about a span of a method body ("extract method": what flows in, what flows
 * out, what is captured, where control leaves).
 *
 * The facts come from flow/region-analysis-semantic.js, which is flow-sensitive and pinned against Roslyn's
 * AnalyzeDataFlow / AnalyzeControlFlow (packages/compiler/test/flow-regions). The model finds the body the span lies
 * in and hands out the results.
 */
import { analyzeSemanticRegion } from '../flow/region-analysis-semantic.js';

/** Class mixin: analyzeDataFlow and analyzeControlFlow. */
export const RegionQueries = Base =>
  class extends Base {
    /** The region analysis of a span, or null when the span is not inside a bound body. */
    regionAt(start, end, uri) {
      const entry = this.index.bodyAt(uri, start);
      if (!entry) return null;
      const options = {
        core: this.core,
        languageVersion: this.driver?.versionOf?.(uri)?.number ?? 14,
        containingType: entry.member.containingType ?? null,
      };
      return analyzeSemanticRegion(entry.body, entry.member, { start, end }, options);
    }
    /**
     * Data-flow facts of the code between two positions of a method body.
     * @returns {null|{variablesDeclared, readInside, writtenInside, readOutside, writtenOutside, dataFlowsIn,
     *   dataFlowsOut, alwaysAssigned, captured, capturedInside, capturedOutside}} sets of local and parameter symbols
     *   as arrays; null outside a bound body
     */
    analyzeDataFlow(start, end, { uri = this.defaultUri } = {}) {
      const region = this.regionAt(start, end, uri);
      if (!region) return null;
      const { statements, controlFlow, ...dataFlow } = region;
      return dataFlow;
    }
    /**
     * Control-flow facts of the statements between two positions of a method body.
     * @returns {null|{statements, returnStatements, exitPoints, entryPoints, startPointIsReachable,
     *   endPointIsReachable}} bound statements; null outside a body
     */
    analyzeControlFlow(start, end, { uri = this.defaultUri } = {}) {
      const region = this.regionAt(start, end, uri);
      return region ? { statements: region.statements, ...region.controlFlow } : null;
    }
  };
