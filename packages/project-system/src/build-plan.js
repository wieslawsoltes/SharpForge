import { EvaluationError } from './evaluation/errors.js';
import { createOutputLayout } from './output-layout.js';
import { resolveBuildContextGraph } from './build-contexts.js';
import { planBuildUnit } from './build-unit.js';

/** Plan one isolated compilation per project; project references refer to assembly outputs, never merged source. */
export function createBuildPlan(system, startup = system.solution?.projectPaths[0]) {
  const graph = resolveBuildContextGraph(system, startup);
  const units = graph.nodes.map(node => planBuildUnit(system, node));
  return { startup, startupContextId: graph.startupContextId, units, outputLayout: createOutputLayout(system.projects, startup),
    diagnostics: units.flatMap(unit => unit.diagnostics) };
}

/** Read one dependency context after preparation, allowing later contexts to keep unopened or future inputs. */
export function createBuildUnit(system, startup, contextId) {
  const graph = resolveBuildContextGraph(system, startup);
  const node = graph.nodes.find(value => value.id === contextId);
  if (!node) throw new EvaluationError('The requested context is absent from the selected build graph.', 'SFP1901');
  return planBuildUnit(system, node);
}
