/**
 * Shared evaluations for pattern matching (SF-A02-T08.2).
 *
 * A switch tests its arms in order, and several arms usually test the same thing (`{ X: 0, Y: 0 }`, then `{ X: 0 }`).
 * Roslyn builds a decision DAG so that each input - the governing value, a property of it, a property of that - is
 * evaluated once whichever path is taken. This module provides the same guarantee for the sequential decision list
 * the code generator emits: every distinct input is a node keyed by its access path from the governing value,
 * evaluated on first use into a temporary and guarded by a flag, so later tests on any path reuse the value.
 *
 * The module is independent of the code generator: it is given factories for the nodes it needs.
 */

/** One input of the decision: the governing value or a member reached from another input. */
export class DecisionInput {
  /** @param {string} key access path from the governing value  @param type the static type symbol of the value */
  constructor(key, type, read) {
    this.key = key;
    this.type = type;
    this.read = read;
  }
}

export class SharedEvaluations {
  /**
   * @param {object} factory `{temp(type, hint), assign(target, value), local(variable), literal(value, type),
   *   conditional(condition, whenTrue, whenFalse, type), sequence(locals, effects, value)}`
   */
  constructor(factory) {
    this.factory = factory;
    this.inputs = new Map();
    /** Temporaries to declare around the whole decision. */
    this.locals = [];
    /** Statements that reset the evaluation flags; run once before the first test. */
    this.resets = [];
    /** How many times each key was materialised at run time is at most one; this counts the distinct inputs. */
    this.evaluations = 0;
  }
  /** The governing value, already held in a temporary or a variable. */
  root(type, read) {
    return new DecisionInput('', type, read);
  }
  /**
   * The input reached from `parent` through `name`; `build()` creates the expression that reads it.
   * The same parent and name give the same input, evaluated at most once: the first test that reaches it at run time
   * stores the value and sets its flag (which test that is depends on the path taken, so the flag is a run-time one).
   */
  member(parent, name, type, imageType, build) {
    const key = parent.key + '.' + name;
    let input = this.inputs.get(key);
    if (input) return input;
    this.evaluations++;
    const f = this.factory,
      value = f.temp(imageType, 'member'),
      flag = f.temp('bool', 'evaluated');
    this.locals.push(value, flag);
    this.resets.push(f.assign(f.local(flag), f.literal(false, 'bool')));
    input = new DecisionInput(key, type, () =>
      f.conditional(
        f.local(flag),
        f.local(value),
        f.sequence([], [f.assign(f.local(value), build()), f.assign(f.local(flag), f.literal(true, 'bool'))], f.local(value)),
        imageType,
      ),
    );
    this.inputs.set(key, input);
    return input;
  }
}
