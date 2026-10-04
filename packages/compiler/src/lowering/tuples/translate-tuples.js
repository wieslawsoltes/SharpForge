/**
 * Lowering of tuple expressions (SF-A02-T08.4): literals, element reads and stores, tuple conversions, `==` / `!=`
 * and the default value. Tuples are objects of synthesized classes that are never changed after creation
 * (lowering/tuples/tuple-classes.js); a store into an element replaces the tuple in its variable (locations.js).
 */
import { tupleElementIndex, tupleElements, maxTupleElements } from '../../binder/tuples.js';
import {isScalarType} from '../../codegen/scalar-values.js';
import {scalarStep, scalarCompound} from '../../codegen/semantic/scalar-step.js';
import { n } from '../../codegen/semantic/node-factory.js';
import { isTupleElement, isTupleRest } from './locations.js';

const tupleConversions = new Set(['ImplicitTuple', 'ExplicitTuple', 'ImplicitTupleLiteral', 'ExplicitTupleLiteral']);

/** A bound node standing for an already lowered value, so that bound-level lowering (conversions) can be applied to it. */
export const lowered = (value, type, syntax) => ({ kind: 'Lowered', syntax, type, constantValue: null, lowered: value });

/** Class mixin: tuples. */
export const TupleTranslation = Base =>
  class extends Base {
    exprLowered(node) {
      return node.lowered;
    }
    exprTuple(node) {
      if (!node.type) return this.unsupported('a tuple literal without a type', node.syntax);
      const info = this.g.tuples.classOf(node.type, node.syntax);
      return this.g.tuples.create(
        info,
        node.elements.map(element => this.expression(element)),
      );
    }
    /**
     * An argument that is a tuple literal without a type of its own (`M((0, null))`) reaches code generation without
     * the conversion to its parameter: it is built directly as the parameter's tuple type.
     */
    arguments(node, method) {
      const parameters = method?.parameters ?? [],
        positions = node.mapping?.parameterOf;
      const untyped = argument => argument.expression?.kind === 'Tuple' && !argument.expression.type;
      if (!(node.args ?? []).some(untyped)) return super.arguments(node, method);
      const args = node.args.map((argument, index) => {
        const parameter = parameters[positions ? positions[index] : index];
        if (!untyped(argument) || !parameter) return argument;
        const value = this.tupleLiteralAs(argument.expression, parameter.type);
        return { ...argument, expression: lowered(value, parameter.type, argument.expression.syntax) };
      });
      return super.arguments({ ...node, args }, method);
    }
    tupleLiteralAs(literal, type) {
      if (!this.g.tuples.handles(type) || tupleElements(type).length !== literal.elements.length)
        return this.unsupported('a tuple literal without a type', literal.syntax);
      const info = this.g.tuples.classOf(type, literal.syntax);
      const elements = literal.elements.map((element, index) => {
        const elementType = tupleElements(type)[index].type;
        if (element.kind === 'Tuple' && !element.type) return this.tupleLiteralAs(element, elementType);
        if (!element.type) return this.defaultValue(info.imageTypes[index]);
        const value = this.expression(element);
        if (value.legacyType === info.imageTypes[index]) return value;
        if (value.legacyType === 'int' && info.imageTypes[index] === 'double') return n.convert(value, 'double');
        return this.unsupported('a tuple literal whose elements need a conversion in this position', element.syntax);
      });
      return this.g.tuples.create(info, elements);
    }
    defaultValue(type) {
      const info = this.g.tuples.infoOf(type);
      return info ? this.g.tuples.defaultInstance(info, elementType => this.defaultValue(elementType)) : super.defaultValue(type);
    }
    /** A tuple read from a field or an array element that was never assigned is the default tuple, not null. */
    tupleOrDefault(value, info) {
      return n.coalesce(value, this.defaultValue(info.record.name), info.record.name);
    }
    storedTuple(value) {
      const info = this.g.tuples.infoOf(value.legacyType);
      return info ? this.tupleOrDefault(value, info) : value;
    }
    fieldReference(node) {
      const index = tupleElementIndex(node.field);
      if (index < 0) return super.fieldReference(node);
      const info = this.g.tuples.classOf(node.receiver.type, node.syntax);
      return n.field(this.expression(node.receiver), info.fields[index]);
    }
    /** `tuple.Rest` of a long tuple: a new tuple of the elements from the eighth on. */
    restOf(node) {
      const info = this.g.tuples.classOf(node.receiver.type, node.syntax),
        rest = this.g.tuples.classOf(node.type, node.syntax),
        value = this.once(this.expression(node.receiver), 'tuple'),
        elements = info.fields.slice(maxTupleElements).map(field => n.field(value.read(), field));
      return n.sequence(value.locals, value.effects, this.g.tuples.create(rest, elements));
    }
    exprFieldAccess(node) {
      if (isTupleRest(node)) return this.restOf(node);
      const value = super.exprFieldAccess(node);
      return isTupleElement(node) ? value : this.storedTuple(value);
    }
    exprArrayAccess(node) {
      return this.storedTuple(super.exprArrayAccess(node));
    }
    exprPropertyAccess(node) {
      return this.storedTuple(super.exprPropertyAccess(node));
    }
    target(node) {
      // An assignment target is the location itself, not the value read from it.
      return node.kind === 'ArrayAccess' ? super.exprArrayAccess(node) : super.target(node);
    }
    // ---- stores into elements ----
    exprAssignment(node) {
      if (!isTupleElement(node.left)) return super.exprAssignment(node);
      return this.storeInto(this.location(node.left), this.expression(node.right));
    }
    exprCompoundAssignment(node) {
      if (!isTupleElement(node.left)) return super.exprCompoundAssignment(node);
      if (node.method && !isScalarType(this.imageType(node.left.type, node.syntax))) {
        return this.unsupported('compound assignment through a user-defined operator', node.syntax);
      }
      const location = this.location(node.left),
        type = this.imageType(node.left.type, node.syntax),
        right = this.expression(node.right),
        result = scalarCompound(node, location.read(), right, type) ??
          n.binary(node.operator, location.read(), right, type, !!node.isChecked);
      return this.storeInto(location, result);
    }
    exprIncrement(node) {
      if (!isTupleElement(node.operand)) return super.exprIncrement(node);
      if (node.method && !isScalarType(this.imageType(node.operand.type, node.syntax))) {
        return this.unsupported('increment through a user-defined operator', node.syntax);
      }
      const location = this.location(node.operand),
        type = this.imageType(node.operand.type, node.syntax),
        before = this.temp(type, 'before'),
        after = scalarStep(node, n.local(before), type) ??
          n.binary(node.operator[0], n.local(before), n.literal(1, type), type, !!node.isChecked),
        stored = this.storeInto({ ...location, locals: [], effects: [] }, after);
      return n.sequence(
        [...location.locals, before],
        [...location.effects, n.assign(n.local(before), location.read())],
        node.isPostfix ? n.sequence([], [stored], n.local(before)) : stored,
      );
    }
    // ---- operators and conversions ----
    /** A bound node with a substitution stands for a value that was already evaluated (a part of a tuple comparison). */
    expression(node) {
      const part = this.substitutions?.get(node);
      return part ? part() : super.expression(node);
    }
    /** Runs `build` with bound nodes replaced by thunks that read their already evaluated values. */
    withSubstitutions(parts, build) {
      const outer = this.substitutions;
      this.substitutions = new Map([...(outer ?? []), ...parts]);
      try {
        return build();
      } finally {
        this.substitutions = outer;
      }
    }
    /**
     * `left == right` on tuples: every element of both operands is evaluated once, left operand first, and then the
     * elements are compared pair by pair with the operator the binder resolved for the pair, stopping at the first
     * pair that decides the result.
     */
    exprBinary(node) {
      if (node.family !== 'tuple') return super.exprBinary(node);
      const evaluation = { locals: [], effects: [] };
      return this.withSubstitutions([], () => {
        this.evaluateTupleOperand(node, 'left', evaluation);
        this.evaluateTupleOperand(node, 'right', evaluation);
        return n.sequence(evaluation.locals, evaluation.effects, this.tupleComparison(node));
      });
    }
    /** Evaluates one operand of a tuple comparison and records how each of its parts is read. */
    evaluateTupleOperand(comparison, side, evaluation) {
      const operand = comparison[side],
        parts = comparison.operation[side + 'Parts'],
        hold = lowered => {
          const value = this.once(lowered, 'part');
          evaluation.locals.push(...value.locals);
          evaluation.effects.push(...value.effects);
          return value.read;
        };
      if (operand.kind !== 'Tuple') {
        const tuple = hold(this.expression(operand)),
          info = this.g.tuples.classOf(operand.type, operand.syntax);
        parts.forEach((part, index) => this.substitutions.set(part, () => n.field(tuple(), info.fields[index])));
      }
      parts.forEach((part, index) => {
        const elementOperator = comparison.operation.elements[index];
        if (elementOperator.family === 'tuple' && elementOperator.operation) this.evaluateTupleOperand(elementOperator, side, evaluation);
        else if (operand.kind === 'Tuple') this.substitutions.set(part, hold(this.expression(part)));
      });
    }
    tupleComparison(comparison) {
      const combine = comparison.operator === '==' ? n.logicalAnd : n.logicalOr;
      return comparison.operation.elements
        .map(element => (element.family === 'tuple' && element.operation ? this.tupleComparison(element) : this.expression(element)))
        .reduce((result, element) => combine(result, element));
    }
    exprConversion(node) {
      if (!tupleConversions.has(node.conversion?.kind)) return super.exprConversion(node);
      const target = node.type,
        info = this.g.tuples.classOf(target, node.syntax),
        parts = node.conversion.underlying,
        elementOf = (element, index) =>
          this.expression({
            kind: 'Conversion',
            syntax: element.syntax ?? node.syntax,
            type: tupleElements(target)[index].type,
            constantValue: null,
            operand: element,
            conversion: parts[index],
            isChecked: node.isChecked,
          });
      if (node.operand.kind === 'Tuple') return this.g.tuples.create(info, node.operand.elements.map(elementOf));
      // A tuple value: its elements are read from one evaluation of it and converted one by one.
      const source = this.g.tuples.classOf(node.operand.type, node.syntax),
        value = this.once(this.expression(node.operand), 'tuple'),
        elements = source.fields.map((field, index) =>
          elementOf(lowered(n.field(value.read(), field), tupleElements(node.operand.type)[index].type, node.syntax), index),
        );
      return n.sequence(value.locals, value.effects, this.g.tuples.create(info, elements));
    }
  };
