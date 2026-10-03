/**
 * `yield return` inside `try`/`finally` (SF-A02-T09.1).
 *
 * The try statement stays a real try statement in MoveNext, so every way of leaving it (falling out, `break`,
 * `continue`, `goto`, `yield break`, an exception) runs the finally block exactly as in an ordinary method. Two things
 * are added:
 *
 *   suspension   `yield return` stores a positive state and returns from inside the try block. The finally block is
 *                guarded by `state < 0`, which is false only while the machine is suspending, so it does not run.
 *   resumption   MoveNext may not jump into the middle of a protected region, so a resume is dispatched in stages:
 *                the method's dispatch jumps to the label in front of the outermost try statement, whose block
 *                begins with its own dispatch to the next try statement or to the resume label itself.
 *
 *   L: try { if (state == 3) goto resume3; ...; current = x; state = 3; return true; resume3: state = -1; ... }
 *      finally { if (state < 0) { ...the finally block... } }
 *
 * Disposal of a machine suspended inside a region is in ./disposal.js.
 */
import { n } from '../../codegen/semantic/node-factory.js';

const labelStatement = label => ({ kind: 'LabelStatement', syntax: n.hidden, label });
const gotoStatement = label => ({ kind: 'GotoStatement', syntax: n.hidden, label });

/** `if (state == k) goto target;` for every `{state, target}` entry. */
export function resumeDispatch(state, entries) {
  return entries.map(entry => n.ifStatement(n.equals(state(), n.literal(entry.state, 'int')), gotoStatement(entry.target)));
}

/** Enters a try region of the machine `hoist`; every resume point created until `closeRegion` lies inside it. */
export function openRegion(hoist) {
  const region = { entry: { name: 'try' + hoist.regionCount++ }, dispatch: [] };
  hoist.regions.push(region);
  return region;
}

/**
 * Leaves the innermost try region and builds its statement.
 * @param tryBlock the lowered protected statement  @param finallyBlock the lowered finally block
 */
export function closeRegion(hoist, region, tryBlock, finallyBlock) {
  if (hoist.regions.pop() !== region) throw new Error('Iterator try regions must be closed innermost first');
  const state = () => n.field(hoist.self(), hoist.info.stateField),
    notSuspending = n.binary('<', state(), n.literal(0, 'int'), 'bool');
  return n.block([
    labelStatement(region.entry),
    n.tryStatement(n.block([...resumeDispatch(state, region.dispatch), tryBlock]), [], n.block([n.ifStatement(notSuspending, finallyBlock)])),
  ]);
}

/**
 * Allocates the resume state of a `yield return` and routes it through the enclosing regions.
 * @returns {{state: number, label: object, isProtected: boolean}}
 */
function addResumePoint(hoist) {
  const state = hoist.dispatch.length + 1,
    label = { name: 'resume' + state };
  let target = label;
  for (let i = hoist.regions.length - 1; i >= 0; i--) {
    hoist.regions[i].dispatch.push({ state, target });
    target = hoist.regions[i].entry;
  }
  hoist.dispatch.push({ state, target });
  const isProtected = hoist.regions.length > 0;
  if (isProtected) hoist.machine.protectedStates.push(state);
  return { state, label, isProtected };
}

/**
 * The statements of `yield return value`: store, suspend, and the label MoveNext resumes at. A machine resumed in
 * dispose mode returns at once, from inside its try regions, which runs their finally blocks innermost first.
 */
export function yieldReturn(hoist, value, syntax) {
  const { info, self } = hoist,
    point = addResumePoint(hoist),
    state = () => n.field(self(), info.stateField);
  const statements = [
    n.expressionStatement(n.assign(n.field(self(), info.currentField), value), syntax),
    n.expressionStatement(n.assign(state(), n.literal(point.state, 'int'))),
    n.returnStatement(n.literal(true, 'bool')),
    labelStatement(point.label),
    n.expressionStatement(n.assign(state(), n.literal(-1, 'int'))),
  ];
  if (point.isProtected) statements.push(n.ifStatement(n.field(self(), info.disposingField), n.returnStatement(n.literal(false, 'bool'))));
  return n.block(statements);
}

/** The per-machine state `Frame.hoist` carries while an iterator body is lowered. */
export function newHoist(info, machine, self) {
  return { info, machine, self, dispatch: [], regions: [], regionCount: 0, slots: 0 };
}
