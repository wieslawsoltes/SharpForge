/**
 * Members as tracked variables of the nullable walker (SF-A02-T05.4).
 *
 * As in Roslyn, a field or property read is a variable when its receiver is one: `this.F`, a static member, and
 * `x.Next`, `x.Next.Name` for a tracked `x`. A null test or an assignment therefore refines what a later read of the
 * same member path gives (`if (x.Next != null) x.Next.Run();`). Assigning the receiver forgets its members
 * (FlowState.assign); a method call does not - Roslyn does not assume that calls change members either.
 *
 * Keys: a member of `this` and a static member are keyed by the member symbol itself (the constructor exit check and
 * the MemberNotNull attributes use those keys); a member of another variable is an interned MemberSlot.
 */
import { MemberSlot, NOT_NULL, MAYBE_NULL } from './flow-state.js';
import { nullMatch } from './pattern-nullness.js';
import { SymbolKind } from '../symbols/types.js';

const isMemberAccess = expression => expression?.kind === 'FieldAccess' || expression?.kind === 'PropertyAccess';

/** Class mixin over the nullable walker core. */
export const NullableMemberSlots = Base =>
  class extends Base {
    constructor(...args) {
      super(...args);
      /** receiver key -> member symbol -> MemberSlot */
      this.slots = new Map();
      /** The variable the innermost `a?.` stands for while its right-hand side is walked, or null. */
      this.conditionalReceiver = null;
    }

    variableOf(expression) {
      return isMemberAccess(expression) ? this.memberVariable(expression) : super.variableOf(expression);
    }

    memberVariable(expression) {
      const member = expression.field ?? expression.property;
      if (!member || member.isConst || member.isIndexer) return null;
      const symbol = expression.field ? (member.originalDefinition ?? member) : member,
        receiver = expression.receiver;
      if (member.isStatic || !receiver || receiver.kind === 'This' || receiver.kind === 'Base') return symbol;
      const owner = receiver.kind === 'ConditionalReceiver' ? this.conditionalReceiver : this.variableOf(receiver);
      return owner ? this.slotOf(owner, symbol) : null;
    }

    /** The variable of `member` of the object `receiver` denotes: for the MemberNotNull attributes of a call on it. */
    memberOf(receiver, member) {
      const own = super.memberOf(null, member);
      if (member.isStatic || !receiver || receiver.kind === 'This' || receiver.kind === 'Base') return own;
      const owner = receiver.kind === 'ConditionalReceiver' ? this.conditionalReceiver : this.variableOf(receiver);
      return owner ? this.slotOf(owner, own) : null;
    }

    slotOf(owner, member) {
      let members = this.slots.get(owner);
      if (!members) this.slots.set(owner, (members = new Map()));
      let slot = members.get(member);
      if (!slot) members.set(member, (slot = new MemberSlot(owner, member)));
      return slot;
    }

    /**
     * Stores a new value in a variable. The members of the old value are forgotten; when the value is itself a
     * variable (`x = y`, `x = x.Next`), what is known about its members holds for the target too.
     */
    assignVariable(flow, variable, state, value = null) {
      const source = value ? this.variableOf(value) : null,
        known = [];
      if (source && source !== variable) {
        for (const [key, memberState] of flow.entries) {
          if (key instanceof MemberSlot && key.isMemberOf(source)) known.push([this.pathFrom(source, key), memberState]);
        }
      }
      flow.assign(variable, state);
      for (const [path, memberState] of known) flow.set(path.reduce((owner, member) => this.slotOf(owner, member), variable), memberState);
    }

    /** The members that lead from `owner` to its member `slot`, outermost first. */
    pathFrom(owner, slot) {
      const path = [];
      for (let current = slot; current !== owner; current = current.receiver) path.unshift(current.member);
      return path;
    }

    /** A matched property pattern `{ P: pattern }` says whether `variable.P` is null (and so on, recursively). */
    learnFromSubpatterns(pattern, variable, flow) {
      if (!variable || !flow || pattern?.kind !== 'RecursivePattern') return;
      for (const property of pattern.properties ?? []) {
        const member = property.member;
        if (!member || !property.pattern) continue;
        const slot = this.slotOf(variable, member.kind === SymbolKind.Field ? (member.originalDefinition ?? member) : member),
          match = nullMatch(property.pattern);
        if (match === 'never') flow.set(slot, NOT_NULL);
        else if (match === 'only') flow.set(slot, MAYBE_NULL);
        this.learnFromSubpatterns(property.pattern, slot, flow);
      }
    }

    /** Runs `walk` with `variable` as what the receiver placeholder of a conditional access denotes. */
    withConditionalReceiver(variable, walk) {
      const saved = this.conditionalReceiver;
      this.conditionalReceiver = variable;
      try {
        return walk();
      } finally {
        this.conditionalReceiver = saved;
      }
    }
  };
