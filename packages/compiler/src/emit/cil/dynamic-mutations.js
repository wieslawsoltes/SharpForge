/** Dynamic stores, compound operators, increment and event accessors (SF-A02-T55). */
import { isDynamicType, isDynamicLocation } from './dynamic-arguments.js';
import { DynamicLocation } from './dynamic-locations.js';

/** Class mixin: mutations keep the ordinary location protocol and dispatch operators through the runtime binder. */
export const DynamicMutationEmission = Base =>
  class extends Base {
    location(node) {
      return isDynamicLocation(node) ? new DynamicLocation(this, node) : super.location(node);
    }
    exprAssignment(node, isUsed) {
      return isDynamicLocation(node.left) ? this.dynamicSite(node, 'set') : super.exprAssignment(node, isUsed);
    }
    exprCoalesceAssignment(node, isUsed) {
      if (!isDynamicLocation(node.left)) return super.exprCoalesceAssignment(node, isUsed);
      const location = new DynamicLocation(this, node.left);
      const end = this.il.newLabel();
      location.capture();
      location.load();
      this.il.emit('dup').emit('brtrue', end).emit('pop');
      this.dynamicSite(node, 'set', location.storeOperands);
      this.il.mark(end);
      if (!isUsed) this.il.emit('pop');
      return isUsed ? undefined : false;
    }
    memberInitializer(initializer, created) {
      if (!this.program.dynamicSites.of(initializer, 'initializer')) return super.memberInitializer(initializer, created);
      const receiver = initializer.target.receiver;
      const needsSubstitution = receiver && receiver.kind !== 'ImplicitReceiver';
      const previous = needsSubstitution ? this.substitutions.get(receiver) : null;
      if (needsSubstitution) this.substitutions.set(receiver, created);
      try {
        this.dynamicSite(initializer, 'initializer');
        this.il.emit('pop');
      } finally {
        if (previous) this.substitutions.set(receiver, previous);
        else if (needsSubstitution) this.substitutions.delete(receiver);
      }
    }
    exprCompoundAssignment(node, isUsed) {
      if (!this.program.dynamicSites.of(node)) return super.exprCompoundAssignment(node, isUsed);
      const location = isDynamicLocation(node.left) ? new DynamicLocation(this, node.left, node) : this.location(node.left);
      location.capture();
      if (this.program.dynamicSites.of(node, 'event')) return this.dynamicEventOrCompound(node, isUsed, location);
      return this.dynamicCompoundStore(node, isUsed, location);
    }
    dynamicCompoundStore(node, isUsed, location) {
      location.beginStore();
      this.dynamicSite(node, 'value', [() => location.load()]);
      if (this.program.dynamicSites.of(node, 'convert')) {
        const result = this.temp(this.core.object);
        this.il.emit('stloc', result);
        this.dynamicSite(node, 'convert', [() => this.il.emit('ldloc', result)]);
      }
      return this.finishStore(location, isUsed);
    }
    /** `d.Member += handler`: distinguish an event from a delegate-valued property before reading the member. */
    dynamicEventOrCompound(node, isUsed, location) {
      const il = this.il;
      const property = il.newLabel();
      const end = il.newLabel();
      this.dynamicSite(node, 'event', [location.operands[0]]);
      il.emit('brfalse', property);
      this.dynamicSite(node, 'accessor', [location.operands[0]]);
      if (!isUsed) il.emit('pop');
      il.emit('br', end).mark(property);
      this.dynamicCompoundStore(node, isUsed, location);
      il.mark(end);
      return isUsed ? undefined : false;
    }
    exprIncrement(node, isUsed) {
      if (!isDynamicType(node.operand.type)) return super.exprIncrement(node, isUsed);
      const location = isDynamicLocation(node.operand) ? new DynamicLocation(this, node.operand, node) : this.location(node.operand);
      const before = this.temp(this.core.object);
      location.capture();
      location.load();
      this.il.emit('stloc', before);
      location.beginStore();
      this.dynamicSite(node, 'value', [() => this.il.emit('ldloc', before)]);
      if (isUsed && node.isPostfix) {
        location.endStore();
        this.il.emit('ldloc', before);
        return undefined;
      }
      return this.finishStore(location, isUsed);
    }
  };
