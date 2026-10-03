/**
 * Lowering of deconstruction (SF-A02-T08.5), in the order C# prescribes:
 *   1. the target locations are evaluated left to right (receivers and indices, not the stores);
 *   2. the right side is evaluated and split - a tuple literal element by element, a tuple value into its fields,
 *      anything else by calling its `Deconstruct` method with one cell per `out` parameter;
 *   3. every part is converted to the type of its target;
 *   4. the parts are stored, left to right.
 * Parts are held in temporaries between steps, so `(a, b) = (b, a)` swaps.
 */
import { n } from '../../codegen/semantic/node-factory.js';
import { lowered } from './translate-tuples.js';

const located = new Set(['Local', 'Parameter', 'FieldAccess', 'ArrayAccess']);

/** Class mixin: deconstruction. */
export const DeconstructionTranslation = Base =>
  class extends Base {
    exprDeconstructionAssignment(node) {
      return this.unsupported('the value of a deconstruction', node.syntax);
    }
    effect(node) {
      if (node.kind !== 'DeconstructionAssignment') return super.effect(node);
      const work = { locals: [], effects: [], stores: [] };
      const targets = this.deconstructionTargets(node.left, work);
      this.splitValue(node.plan, node.right, null, targets, work);
      const conversions = work.stores.map(store => store.prepare()).flat();
      const stores = work.stores.filter(store => store.write).map(store => store.write());
      return n.sequence(work.locals, [...work.effects, ...conversions, ...stores], n.nullLiteral('object'));
    }
    /** Step 1: the locations of the targets, as a tree shaped like the target tuple (`null` for a discard). */
    deconstructionTargets(target, work) {
      switch (target.kind) {
        case 'Tuple':
          return target.elements.map(element => this.deconstructionTargets(element, work));
        case 'Discard':
          return null;
        case 'DeclarationExpression':
          this.declarePending(target.local);
          return value => n.assign(this.variable(target.local, target.syntax), value);
        default: {
          if (!located.has(target.kind)) return this.memberTarget(target, work);
          const location = this.location(target);
          work.locals.push(...location.locals);
          work.effects.push(...location.effects);
          return value => location.write(value);
        }
      }
    }
    /** A property or indexer target: its receiver and arguments are evaluated now, the accessor is called at the store. */
    memberTarget(target, work) {
      const pinned = [target.receiver, ...(target.args ?? []).map(argument => argument.expression)]
        .filter(part => part && part.kind !== 'This' && part.kind !== 'Base')
        .map(part => [part, this.held(this.expression(part), work, 'target')]);
      return value => {
        const store = { kind: 'Assignment', syntax: target.syntax, type: target.type, constantValue: null, left: target };
        return this.withSubstitutions(pinned, () => this.expression({ ...store, right: lowered(value, target.type, target.syntax) }));
      };
    }
    /** Holds a lowered value in a temporary (literals are read directly). */
    held(value, work, hint) {
      if (value.kind === 'Literal') return () => value;
      const temp = this.temp(value.legacyType, hint);
      work.locals.push(temp);
      work.effects.push(n.assign(n.local(temp), value));
      return () => n.local(temp);
    }
    /**
     * Steps 2 and 3 for one plan node. `bound` is the bound value when the plan was made from an expression, `read`
     * a thunk reading an already evaluated value otherwise.
     */
    splitValue(plan, bound, read, target, work) {
      switch (plan.kind) {
        case 'leaf':
          return this.splitLeaf(plan, bound, read, target, work);
        case 'literal':
          return plan.parts.forEach((part, index) => this.splitValue(part, bound.elements[index], null, target[index], work));
        case 'tuple': {
          const info = this.g.tuples.classOf(plan.type, bound?.syntax),
            tuple = read ?? this.held(this.expression(bound), work, 'tuple');
          return plan.parts.forEach((part, index) => this.splitValue(part, null, () => n.field(tuple(), info.fields[index]), target[index], work));
        }
        default:
          return this.splitByMethod(plan, bound, read, target, work);
      }
    }
    splitLeaf(plan, bound, read, write, work) {
      // A part is evaluated even when it is discarded: its side effects happen.
      const value = read ?? this.held(this.expression(bound), work, 'part'),
        conversion = plan.conversion;
      if (!write) return;
      if (!conversion || conversion.kind === 'Identity') {
        work.stores.push({ prepare: () => [], write: () => write(value()) });
        return;
      }
      const syntax = plan.target.syntax,
        operand = lowered(value(), bound?.type ?? plan.sourceType, syntax);
      const converted = this.temp(this.imageType(plan.type, syntax), 'converted');
      work.locals.push(converted);
      const convert = () => this.expression({ kind: 'Conversion', syntax, type: plan.type, constantValue: null, operand, conversion });
      work.stores.push({ prepare: () => [n.assign(n.local(converted), convert())], write: () => write(n.local(converted)) });
    }
    /** `value.Deconstruct(out p1, .., out pn)`: every `out` parameter gets a fresh cell, read after the call. */
    splitByMethod(plan, bound, read, target, work) {
      const syntax = bound?.syntax ?? plan.method.locations?.[0],
        method = this.g.methodOf(plan.method.originalDefinition ?? plan.method, syntax),
        receiver = read ? read() : this.expression(bound),
        outs = plan.isExtension ? plan.method.parameters.slice(1) : plan.method.parameters;
      const cells = outs.map(parameter => {
        const cell = this.g.cellClass(this.imageType(parameter.type, syntax)),
          temp = this.temp(cell.record.name, 'out');
        work.locals.push(temp);
        work.effects.push(n.assign(n.local(temp), n.allocate(cell.record)));
        return { temp, cell };
      });
      const args = cells.map(({ temp }) => n.local(temp));
      work.effects.push(plan.isExtension ? n.call(method, null, [receiver, ...args]) : n.call(method, receiver, args));
      plan.parts.forEach((part, index) => {
        const { temp, cell } = cells[index];
        this.splitValue(part, null, () => n.field(n.local(temp), cell.value), target[index], work);
      });
    }
  };
