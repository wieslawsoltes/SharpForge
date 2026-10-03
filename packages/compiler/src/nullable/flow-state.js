/**
 * Null-states and the per-path state of the nullable walker.
 * A variable is 'notNull' or 'maybeNull'; a variable without an entry has the state its declared annotation gives it.
 */
export const NOT_NULL = 'notNull';
export const MAYBE_NULL = 'maybeNull';

/** The state of a value that may come from either of two paths. */
export const joinStates = (a, b) => (a === MAYBE_NULL || b === MAYBE_NULL ? MAYBE_NULL : NOT_NULL);

/** The variable states on one control-flow path; `null` stands for unreachable code. */
export class FlowState {
  constructor(entries = new Map()) {
    this.entries = entries;
  }
  clone() {
    return new FlowState(new Map(this.entries));
  }
  get(variable) {
    return this.entries.get(variable);
  }
  set(variable, state) {
    this.entries.set(variable, state);
  }
}

/** The state where two paths meet. An unreachable path does not constrain the other. */
export function joinFlow(a, b) {
  if (!a) return b ? b.clone() : null;
  if (!b) return a.clone();
  const result = new FlowState();
  for (const variable of new Set([...a.entries.keys(), ...b.entries.keys()])) {
    const left = a.get(variable);
    const right = b.get(variable);
    // A variable known on one path only keeps its declared state on the other, which cannot be improved on.
    if (left !== undefined && right !== undefined) result.set(variable, joinStates(left, right));
    else if ((left ?? right) === MAYBE_NULL) result.set(variable, MAYBE_NULL);
  }
  return result;
}
