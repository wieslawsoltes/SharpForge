/**
 * Flow-sensitive facts of a region of a method body (SF-A02-T35), on the walker of the definite assignment analysis
 * (flow/assignment): the same statement and expression rules, with every local and parameter tracked and the reads
 * and writes handed to a pass instead of being checked.
 *
 * Two passes use it (flow/region-analysis-semantic.js):
 *   - over the region alone, starting with nothing assigned: a read of a variable the region has not assigned yet
 *     needs a value from outside (data flows in); the states where control leaves say what is always assigned;
 *   - over the whole body, tracking the variables whose value certainly does not come from the region: a read outside
 *     the region of any other variable takes a value the region wrote (data flows out).
 *
 * The body of a lambda is walked where the lambda is created; the body of a local function is not walked at all -
 * a call of it reads and writes what it captures (flow/region-references.js), as in Roslyn.
 */
import { AssignmentAnalyzerCore } from './assignment/analyzer-core.js';
import { AssignmentExpressions } from './assignment/expressions.js';
import { AssignmentStatements } from './assignment/statements.js';
import { join } from './assignment/state.js';
import { RefKind } from '../symbols/types.js';
import { spanOfNode } from './region-references.js';

const variableOf = node => (node?.kind === 'Local' ? node.local : node?.kind === 'Parameter' ? node.parameter : null);
const readWriteKinds = new Set(['CompoundAssignment', 'Increment', 'CoalesceAssignment']);
const loopKinds = new Set(['While', 'Do', 'For', 'ForEach']);
const callKinds = new Set(['Call', 'ObjectCreation', 'IndexerAccess']);
const contains = (outer, inner) => !!outer && !!inner && outer.start <= inner.start && inner.end <= outer.end;

/** The variable a field access chain starts from (`p.X.Y` -> p), or null. */
function rootVariable(node) {
  let current = node;
  while (current?.kind === 'FieldAccess' && current.receiver) current = current.receiver;
  return current === node ? null : variableOf(current);
}

/**
 * The assignment walker with hooks. `pass` is
 * `{read(variable, node, state), write(variable, node, state, isDefinite), exit?(node, state), enter?(statement, state)}`
 * and `context` is `{effectsOf, isLocalFunction, region}` (the captured reads and writes of a function, the span of
 * the region).
 */
export class RegionWalker extends AssignmentStatements(AssignmentExpressions(AssignmentAnalyzerCore)) {
  constructor(method, options, pass, context) {
    super(method, options);
    this.pass = pass;
    this.context = context;
    this.functionDepth = 0;
  }
  tracked() {
    return true;
  }
  report() {}
  leave() {}
  /** A local function runs where it is called. */
  localFunction() {}

  read(variable, node, state) {
    if (state) this.pass.read(variable, node, state);
  }
  write(variable, node, state, isDefinite) {
    if (!state || !variable) return;
    if (isDefinite) state.add(variable);
    this.pass.write(variable, node, state, isDefinite);
  }

  expr(e, state) {
    if (!e || typeof e !== 'object' || !state) return super.expr(e, state);
    if (e.kind === 'Parameter') {
      this.read(e.parameter, e, state);
      return state;
    }
    if (e.kind === 'FieldAccess') {
      const root = rootVariable(e);
      if (root) {
        this.read(root, e, state);
        return state;
      }
    }
    if (e.kind === 'Lambda') return this.lambda(e, state);
    if (e.kind === 'MethodGroup') {
      for (const method of e.methods ?? []) this.callEffects(method, e, state);
      return state;
    }
    const after = super.expr(e, state);
    if (!after) return after;
    if (readWriteKinds.has(e.kind)) this.write(variableOf(e.left ?? e.operand), e, after, true);
    if (callKinds.has(e.kind)) {
      // A `ref` argument may be assigned by the callee: a write, but not a definite one.
      for (const argument of e.args ?? []) {
        if (argument.refKind === RefKind.Ref) this.write(variableOf(argument.expression ?? argument), e, after, false);
      }
      if (e.kind === 'Call') this.callEffects(e.method, e, after);
    }
    return after;
  }

  /** A call of a local function reads and may write what the function captures. */
  callEffects(method, node, state) {
    const definition = method?.originalDefinition ?? method;
    if (!definition || !this.context.isLocalFunction(definition)) return;
    const effects = this.context.effectsOf(definition);
    for (const variable of effects.reads) this.read(variable, node, state);
    for (const variable of effects.writes) this.write(variable, node, state, false);
  }

  /** The body is walked with the state at the creation; what it writes may be written whenever the lambda runs. */
  lambda(e, state) {
    if (!e.body) return state;
    const inner = state.clone(),
      saved = this.loops;
    this.loops = [];
    this.functionDepth++;
    if (e.body.kind && 'completes' in e.body) this.stmt(e.body, inner);
    else this.expr(e.body, inner);
    this.functionDepth--;
    this.loops = saved;
    for (const variable of this.context.effectsOf(e).writes) this.write(variable, e, state, false);
    return state;
  }

  assign(left, state) {
    const after = super.assign(left, state);
    if (!after || !left) return after;
    if (left.kind === 'Tuple') return after;
    const variable = left.kind === 'DeclarationExpression' ? left.local : variableOf(left);
    if (variable) this.pass.write(variable, left, after, true);
    else this.write(rootVariable(left), left, after, false);
    return after;
  }

  declarations(list, state) {
    let current = state;
    for (const declaration of list) {
      current = super.declarations([declaration], current);
      if (current && declaration.value) this.pass.write(declaration.local, { syntax: declaration.local.syntax }, current, true);
    }
    return current;
  }

  patternLocals(pattern, state, isDefinite) {
    super.patternLocals(pattern, state, isDefinite);
    if (state && isDefinite && pattern?.local) this.pass.write(pattern.local, { syntax: pattern.local.syntax ?? pattern.syntax }, state, true);
  }

  stmt(s, state) {
    if (!s || !state) return super.stmt(s, state);
    this.pass.enter?.(s, state);
    if (this.functionDepth === 0) {
      if (s.kind === 'Return') {
        const after = s.expression ? this.expr(s.expression, state) : state;
        if (after) this.pass.exit?.(s, after);
        return null;
      }
      if (s.kind === 'Break' && !this.loops.length) return this.leaveRegion(s, state);
      if (s.kind === 'Continue' && !this.loops.some(frame => frame.isLoop)) return this.leaveRegion(s, state);
    }
    const entry = loopKinds.has(s.kind) && this.pass.needsBackEdge?.(s) ? (join(state, this.backEdge(s, state.clone())) ?? state) : state;
    return super.stmt(s, entry);
  }

  leaveRegion(s, state) {
    this.pass.exit?.(s, state);
    return null;
  }

  /** One pass over a loop: the state its back edge brings to the loop head. */
  backEdge(s, state) {
    const frame = () => this.enter(true),
      close = (loop, after) => {
        this.loops.pop();
        return join(after, loop.continues);
      };
    switch (s.kind) {
      case 'While': {
        const condition = this.cond(s.condition, state),
          loop = frame();
        return close(loop, this.stmt(s.body, condition.t));
      }
      case 'Do': {
        const loop = frame(),
          after = close(loop, this.stmt(s.body, state));
        return after ? this.cond(s.condition, after).t : null;
      }
      case 'For': {
        let current = this.declarations(s.declaration ?? [], state);
        for (const initializer of s.initializers ?? []) current = this.expr(initializer, current);
        const condition = s.condition ? this.cond(s.condition, current) : { t: current },
          loop = frame();
        let after = close(loop, this.stmt(s.body, condition.t?.clone() ?? null));
        for (const incrementor of s.incrementors ?? []) after = this.expr(incrementor, after);
        return after;
      }
      default: {
        const loop = frame();
        return close(loop, this.stmt(s.body, this.expr(s.collection, state)));
      }
    }
  }
}

/** True when the span of `node` lies inside `region`. */
export const isInside = (node, region) => contains(region, spanOfNode(node));
