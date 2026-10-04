/**
 * Region analysis over the semantic bound tree (SF-A02-T35): what a run of statements reads, writes, needs from
 * outside and hands back, what it captures and how control enters and leaves it - Roslyn's AnalyzeDataFlow and
 * AnalyzeControlFlow, pinned in packages/compiler/test/flow-regions.
 *
 *   variablesDeclared               locals (and lambda parameters) declared inside the region
 *   readInside, writtenInside, readOutside, writtenOutside      by the position of each reference; the parameters
 *                                   of the method are written outside (by the caller)
 *   dataFlowsIn                     read inside before the region itself has assigned them on that path
 *   dataFlowsOut                    written inside, and that value can reach a read outside the region
 *   alwaysAssigned                  assigned on every path that leaves the region (its end, return, break, continue)
 *   captured, capturedInside, capturedOutside   used in a lambda or local function other than the declaring one;
 *                                   inside / outside by the position of that use
 *   control flow                    start and end point reachability, the return statements and the jumps that leave
 *
 * A region is the outermost statements that lie inside the span. A span that selects no statement (an expression)
 * gets the position-based sets only: there dataFlowsIn is what is read and not declared inside, and nothing else.
 */
import { walk, forEachChild } from '../bound/semantic-walker.js';
import { AssignmentState } from './assignment/state.js';
import { collectReferences, spanOfNode } from './region-references.js';
import { RegionWalker } from './region-flow.js';

const contains = (outer, inner) => !!outer && !!inner && outer.start <= inner.start && inner.end <= outer.end;
const isStatement = node => 'completes' in node;
const loopKinds = new Set(['While', 'Do', 'For', 'ForEach']);

/** The outermost statements whose span lies inside `span`, in source order. */
export function statementsInside(body, span) {
  const statements = [];
  walk(body, node => {
    if (!isStatement(node) || !contains(span, spanOfNode(node))) return undefined;
    statements.push(node);
    return false;
  });
  return statements;
}

/** The return statements of the region and the jumps that leave it; lambdas and local functions are functions of their own. */
function exitsOf(statements) {
  const returnStatements = [],
    exitPoints = [];
  const visit = (node, loops, switches) => {
    if (node.kind === 'Lambda' || node.kind === 'LocalFunction') return;
    if (node.kind === 'Return') {
      returnStatements.push(node);
      exitPoints.push(node);
    } else if (node.kind === 'Break' && !loops && !switches) exitPoints.push(node);
    else if (node.kind === 'Continue' && !loops) exitPoints.push(node);
    const isLoop = loopKinds.has(node.kind),
      isSwitch = node.kind === 'Switch';
    forEachChild(node, child => visit(child, loops + (isLoop ? 1 : 0), switches + (isSwitch ? 1 : 0)));
  };
  for (const statement of statements) visit(statement, 0, 0);
  return { returnStatements, exitPoints };
}

const distinct = list => [...new Set(list)];

/**
 * @param body the bound body of the method  @param member the method symbol (its parameters are written by the caller)
 * @param {{start: number, end: number}} span the selected span
 * @param {{core: object, languageVersion: number, containingType: object|null}} options as for definite assignment
 * @returns the data-flow sets as arrays of symbols, `statements`, and `controlFlow`
 */
export function analyzeSemanticRegion(body, member, span, options) {
  const parameters = member?.parameters ?? [],
    collected = collectReferences(body, parameters),
    statements = statementsInside(body, span),
    first = statements[0] ?? null,
    region = first ? { start: spanOfNode(first).start, end: spanOfNode(statements.at(-1)).end } : span,
    inRegion = reference => contains(region, reference.span),
    of = (kind, isInside) => distinct(collected.references.filter(r => r.kind === kind && inRegion(r) === isInside).map(r => r.variable));
  const readInside = of('read', true),
    writtenInside = of('write', true),
    declared = [...collected.owners.keys()].filter(variable => !parameters.includes(variable) && contains(region, spanOfNode({ syntax: variable.syntax })));
  const sets = {
    variablesDeclared: declared,
    readInside,
    writtenInside,
    readOutside: of('read', false),
    writtenOutside: distinct([...parameters, ...of('write', false)]),
    captured: distinct(collected.captures.map(capture => capture.variable)),
    capturedInside: distinct(collected.captures.filter(capture => contains(region, capture.span)).map(capture => capture.variable)),
    capturedOutside: distinct(collected.captures.filter(capture => !contains(region, capture.span)).map(capture => capture.variable)),
  };
  if (!first) {
    const declaredSet = new Set(declared),
      controlFlow = { startPointIsReachable: false, endPointIsReachable: false, returnStatements: [], exitPoints: [], entryPoints: [] };
    return { ...sets, dataFlowsIn: readInside.filter(v => !declaredSet.has(v)), dataFlowsOut: [], alwaysAssigned: [], statements, controlFlow };
  }
  const context = { effectsOf: collected.effectsOf, isLocalFunction: collected.isLocalFunction, region },
    isInside = node => contains(region, spanOfNode(node));

  // The whole body: which values written in the region are read outside it, and whether the region is reached.
  const dataFlowsOut = new Set();
  let startPointIsReachable = false;
  const universe = new AssignmentState(new Set([...collected.owners.keys(), ...parameters]));
  new RegionWalker(member, options, {
    read(variable, node, state) {
      if (!isInside(node) && !state.has(variable)) dataFlowsOut.add(variable);
    },
    write(variable, node, state, isDefinite) {
      if (isInside(node)) state.set.delete(variable);
      else if (isDefinite) state.add(variable);
    },
    enter(statement) {
      if (statement === first) startPointIsReachable = true;
    },
    // A loop that contains the region or lies in it: what the region writes comes round to the loop head.
    needsBackEdge: loop => contains(spanOfNode(loop), region) || isInside(loop),
  }, context).stmt(body, universe);

  // The region alone: what it reads before assigning it, and what is assigned wherever control leaves it.
  const dataFlowsIn = new Set(),
    exitStates = [];
  const end = new RegionWalker(member, options, {
    read(variable, node, state) {
      if (!state.has(variable)) dataFlowsIn.add(variable);
    },
    write() {},
    exit(node, state) {
      exitStates.push(state.clone());
    },
  }, context).stmt({ kind: 'Block', statements, completes: true }, new AssignmentState());
  const leaving = end ? [end, ...exitStates] : exitStates,
    declaredSet = new Set(declared),
    isAlwaysAssigned = variable => !startPointIsReachable || !leaving.length || leaving.every(state => state.has(variable));
  return {
    ...sets,
    dataFlowsIn: startPointIsReachable ? [...dataFlowsIn].filter(variable => !declaredSet.has(variable)) : [],
    dataFlowsOut: [...dataFlowsOut].filter(variable => writtenInside.includes(variable)),
    alwaysAssigned: writtenInside.filter(isAlwaysAssigned),
    statements,
    controlFlow: { startPointIsReachable, endPointIsReachable: startPointIsReachable && !!end, ...exitsOf(statements), entryPoints: [] },
  };
}
