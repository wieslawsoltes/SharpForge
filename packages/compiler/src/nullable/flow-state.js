/**
 * Null-states and the per-path state of the nullable walker.
 * A variable is 'notNull' or 'maybeNull'; a variable without an entry has the state its declared annotation gives it.
 */
export const NOT_NULL = 'notNull';
export const MAYBE_NULL = 'maybeNull';

/** The state of a value that may come from either of two paths. */
export const joinStates = (a, b) => (a === MAYBE_NULL || b === MAYBE_NULL ? MAYBE_NULL : NOT_NULL);

/**
 * A member of a tracked variable as a variable of its own: `x.Next`, `x.Next.Name`, `this.Items.Count`.
 * Slots are interned by the walker, so the same receiver and member always give the same key.
 */
export class MemberSlot {
  constructor(receiver, member) {
    this.receiver = receiver;
    this.member = member;
  }
  /** True when the slot is a member, at any depth, of `variable`. */
  isMemberOf(variable) {
    for (let slot = this; slot instanceof MemberSlot; slot = slot.receiver) if (slot.receiver === variable) return true;
    return false;
  }
}

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
  /** Records what a test or a dereference proved about a variable. */
  set(variable, state) {
    this.entries.set(variable, state);
  }
  /** Records a new value of a variable: what was known about the members of the old value no longer holds. */
  assign(variable, state) {
    for (const key of this.entries.keys()) if (key instanceof MemberSlot && key.isMemberOf(variable)) this.entries.delete(key);
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
