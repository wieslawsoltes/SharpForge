/**
 * Deconstruction (SF-A02-T30): `(a, b) = e`, `var (a, b) = e`, nested and mixed forms, in the order C# prescribes:
 *
 *   1. the target locations are evaluated left to right (receivers and indices, not the stores);
 *   2. the right side is evaluated and split - a tuple literal element by element, a tuple value into its fields,
 *      anything else by its `Deconstruct` method with one temporary per `out` parameter;
 *   3. every part is converted to the type of its target;
 *   4. the parts are stored, left to right.
 *
 * Parts are held in temporaries between the steps, so `(a, b) = (b, a)` swaps. A part is a value source
 * `{type, load(), address()}` (emit-tuples.js).
 */
import { TypeKind } from '../../symbols/types.js';
import { tupleElements } from '../../symbols/tuple-elements.js';
import { isReference } from './type-facts.js';

/** Class mixin: deconstruction. */
export const DeconstructionEmission = Base =>
  class extends Base {
    exprDeconstructionAssignment(node, isUsed) {
      const leaves = [],
        targets = this.deconstructionTargets(node.left);
      this.splitValue(node.plan, node.right, null, targets, leaves);
      for (const leaf of leaves) leaf.convert();
      for (const leaf of leaves) leaf.store();
      if (!isUsed) return false;
      if (!node.type) return this.unsupported('the value of this deconstruction', node.syntax);
      return this.deconstructionValue(node.type, targets);
    }
    /** The value of a deconstruction used as an expression: the tuple of what the targets received. */
    deconstructionValue(type, targets) {
      const elements = tupleElements(type);
      const pushers = targets.map((target, index) => () => {
        if (target.nested) return this.deconstructionValue(elements[index].type, target.nested);
        return target.result.load();
      });
      return this.constructTuple(type, pushers);
    }
    /** A value source over a local slot. */
    slotSource(type, slot) {
      return { type, load: () => this.il.emit('ldloc', slot), address: () => this.il.emit('ldloca', slot) };
    }
    /** Evaluates a bound value into a temporary and returns it as a value source. */
    heldValue(node, type = node.type) {
      const slot = this.temp(type);
      this.expression(node);
      this.il.emit('stloc', slot);
      return this.slotSource(type, slot);
    }
    /**
     * Step 1: the targets as a tree shaped like the target tuple. A leaf is `{type, store(source), result}`; `store`
     * is null for a discard, and `result` becomes the source of the value the target received.
     */
    deconstructionTargets(target) {
      return target.elements.map(element => this.deconstructionTarget(element));
    }
    deconstructionTarget(target) {
      switch (target.kind) {
        case 'Tuple':
          return { nested: this.deconstructionTargets(target) };
        case 'Discard':
          return { type: target.type, store: null, result: null };
        case 'DeclarationExpression':
          return {
            type: target.type,
            result: null,
            store: source => {
              source.load();
              this.initializeLocal(target.local);
            },
          };
        default:
          return this.locationTarget(target);
      }
    }
    /** A target that is an existing variable, field, element, property or indexer: its operands are evaluated now. */
    locationTarget(target) {
      const outer = this.assignmentTarget;
      this.assignmentTarget = target;
      let location;
      try {
        location = this.location(target);
      } finally {
        this.assignmentTarget = outer;
      }
      location.capture();
      return {
        type: target.type,
        result: null,
        store: source => {
          location.beginStore();
          source.load();
          location.endStore();
        },
      };
    }
    /**
     * Steps 2 and 3 for one plan node. `bound` is the bound value when the plan was made from an expression,
     * `source` an already evaluated value otherwise. Leaves are appended to `leaves` in target order.
     */
    splitValue(plan, bound, source, target, leaves) {
      switch (plan.kind) {
        case 'leaf':
          return this.splitLeaf(plan, bound, source, target, leaves);
        case 'literal':
          return plan.parts.forEach((part, index) => this.splitValue(part, bound.elements[index], null, this.childTarget(target, index), leaves));
        case 'tuple': {
          const tuple = source ?? this.heldValue(bound),
            parts = this.tupleElementSources(plan.type, tuple.address);
          return plan.parts.forEach((part, index) => this.splitValue(part, null, parts[index], this.childTarget(target, index), leaves));
        }
        default:
          return this.splitByMethod(plan, bound, source, target, leaves);
      }
    }
    childTarget(target, index) {
      return Array.isArray(target) ? target[index] : target.nested[index];
    }
    splitLeaf(plan, bound, source, target, leaves) {
      const conversion = plan.conversion,
        converts = !!conversion && conversion.kind !== 'Identity',
        syntax = plan.target?.syntax ?? bound?.syntax ?? null;
      let value = source;
      // A part is evaluated even when it is discarded: its side effects happen. A literal without a type (`null`,
      // `default`) only has a value as its target's type.
      if (bound && !bound.type) value = this.heldValue(this.convertedNode(bound, conversion, plan.type), plan.type);
      else if (bound) value = this.heldValue(bound);
      target.result = value;
      if (!target.store) return;
      const leaf = { convert() {}, store: () => target.store(target.result) };
      if (converts && !(bound && !bound.type)) {
        leaf.convert = () => {
          const slot = this.temp(plan.type);
          this.convertedSource(value, conversion, plan.type, syntax);
          this.il.emit('stloc', slot);
          target.result = this.slotSource(plan.type, slot);
        };
      }
      leaves.push(leaf);
    }
    /** `value.Deconstruct(out p1, .., out pn)`: every `out` parameter gets a temporary, read after the call. */
    splitByMethod(plan, bound, source, target, leaves) {
      const method = plan.method,
        outs = plan.isExtension ? method.parameters.slice(1) : method.parameters,
        value = source ?? this.heldValue(bound),
        slots = outs.map(parameter => this.temp(parameter.type)),
        receiverType = value.type,
        byAddress = !plan.isExtension && (!isReference(receiverType) || receiverType.typeKind === TypeKind.TypeParameter);
      if (byAddress) value.address();
      else value.load();
      for (const slot of slots) this.il.emit('ldloca', slot);
      this.callMethod(method, { receiver: plan.isExtension ? null : { type: receiverType }, syntax: bound?.syntax });
      plan.parts.forEach((part, index) => {
        this.splitValue(part, null, this.slotSource(outs[index].type, slots[index]), this.childTarget(target, index), leaves);
      });
    }
  };
