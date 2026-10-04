/**
 * Tuples (SF-A02-T30): a tuple is a real `System.ValueTuple<...>` value. A literal is `newobj` of the constructed
 * type's constructor, an element is one of the fields `Item1..Item7`, and an element from the eighth on is a field
 * of the tuple nested in `Rest` (`Item9` of a nine-element tuple is `Rest.Item2`). Tuple conversions and `==` / `!=`
 * work element by element, with each operand evaluated once.
 */
import { isWideTuple, tupleElements, tupleRestPosition } from '../../symbols/tuple-elements.js';
import { FieldLocation } from './locations.js';

const literalConversions = new Set(['ImplicitTupleLiteral', 'ExplicitTupleLiteral']);
const valueConversions = new Set(['ImplicitTuple', 'ExplicitTuple']);

/** The location of a tuple element held in `Rest`: the receiver's address, then the address of each nested tuple. */
class RestElementLocation extends FieldLocation {
  /** @param {number[]} hops the tokens of the `Rest` fields that lead to the tuple holding the element */
  constructor(emitter, field, receiver, hops) {
    super(emitter, field, receiver, field.type);
    const outer = this.receiver;
    this.receiver = {
      capture: () => outer.capture(),
      push: () => {
        outer.push();
        for (const hop of hops) emitter.il.emit('ldflda', hop);
      },
    };
  }
}

/** Class mixin: tuples. */
export const TupleEmission = Base =>
  class extends Base {
    /** The token of the constructor of one ValueTuple construction; its parameters are the type parameters. */
    tupleConstructor(type) {
      const parameters = type.originalDefinition.typeParameters.map(parameter => ({ type: parameter }));
      return this.tokens.external(type, '.ctor', { isStatic: false, returnType: this.core.void, parameters });
    }
    /**
     * Builds a tuple from its elements, which `pushers` push in order (the elements of `Rest` included).
     * @param {(() => void)[]} pushers one per element of the flat tuple
     */
    constructTuple(type, pushers, first = 0) {
      const isWide = isWideTuple(type),
        own = isWide ? tupleRestPosition : type.typeArguments.length;
      for (let index = 0; index < own; index++) pushers[first + index]();
      if (isWide) this.constructTuple(type.typeArguments[tupleRestPosition].type, pushers, first + own);
      this.il.emit('newobj', this.tupleConstructor(type), { pops: type.typeArguments.length, pushes: 1 });
    }
    /**
     * Where the element at a flat position lives: `{hops, token, type}` - the `Rest` fields to go through and the
     * field of the innermost tuple.
     */
    tupleElementPath(type, position) {
      const hops = [];
      let holder = type,
        index = position;
      while (isWideTuple(holder) && index >= tupleRestPosition) {
        hops.push(this.tokens.field(holder.getMembers('Rest')[0]));
        holder = holder.typeArguments[tupleRestPosition].type;
        index -= tupleRestPosition;
      }
      const field = holder.getMembers('Item' + (index + 1))[0];
      return { hops, token: this.tokens.field(field), type: field.type };
    }
    /**
     * The elements of the tuple in a local slot as value sources: `[{type, load(), address()}]`.
     * @param {() => void} pushAddress pushes a managed pointer to the tuple
     */
    tupleElementSources(type, pushAddress) {
      return tupleElements(type).map((element, position) => {
        const path = this.tupleElementPath(type, position),
          reach = instruction => {
            pushAddress();
            for (const hop of path.hops) this.il.emit('ldflda', hop);
            this.il.emit(instruction, path.token);
          };
        return { type: element.type, load: () => reach('ldfld'), address: () => reach('ldflda') };
      });
    }
    exprTuple(node) {
      if (node.isDeconstructionTarget || !node.type) return this.unsupported('a tuple without a type in this position', node.syntax);
      return this.constructTuple(
        node.type,
        node.elements.map(element => () => this.expression(element)),
      );
    }
    /** A tuple literal without a type of its own (`(0, null)`) passed to a parameter takes the parameter's type. */
    argument(argument, parameter) {
      const expression = argument.expression;
      if (expression.kind !== 'Tuple' || expression.type || !parameter?.type?.isTupleType) return super.argument(argument, parameter);
      return this.targetTypedTuple(expression, parameter.type);
    }
    /** Builds `target` from a literal whose elements convert to its element types by a standard implicit conversion. */
    targetTypedTuple(literal, target) {
      const types = tupleElements(target);
      const pushers = literal.elements.map((element, index) => () => {
        const type = types[index].type;
        if (element.kind === 'Tuple' && !element.type) return this.targetTypedTuple(element, type);
        if (!element.type) return this.defaultValue(type);
        this.expression(element);
        return this.implicitStandardConversion(element.type, type, element.syntax);
      });
      return this.constructTuple(target, pushers);
    }
    fieldLocation(field, receiver, type) {
      const position = field.tupleElementIndex;
      if (position === undefined || !receiver) return super.fieldLocation(field, receiver, type);
      const path = this.tupleElementPath(field.containingType, position);
      return new RestElementLocation(this, { token: path.token, isStatic: false, type: field.type }, receiver, path.hops);
    }
    exprConversion(node) {
      const kind = node.conversion?.kind;
      if (literalConversions.has(kind) && node.operand.kind === 'Tuple') return this.tupleLiteralConversion(node);
      if (valueConversions.has(kind) || literalConversions.has(kind)) return this.tupleValueConversion(node);
      return super.exprConversion(node);
    }
    /** `(double, long)? x = (1, 2)`: the tuple is converted first, then wrapped. */
    nullableConversion(node) {
      const to = node.type,
        from = node.operand.type,
        inner = node.conversion?.underlying,
        isTupleConversion = !!inner && !Array.isArray(inner) && (valueConversions.has(inner.kind) || literalConversions.has(inner.kind));
      if (!isTupleConversion || !to.isNullableValueType || from?.isNullableValueType) return super.nullableConversion(node);
      this.expression(this.convertedNode(node.operand, inner, to.nullableUnderlyingType));
      return this.wrapNullable(to);
    }
    /** A bound conversion of `operand` by a classified conversion; the operand itself for an identity. */
    convertedNode(operand, conversion, type) {
      if (!conversion || conversion.kind === 'Identity') return operand;
      return { kind: 'Conversion', syntax: operand.syntax, type, constantValue: null, operand, conversion, isChecked: false };
    }
    /** `(long, object) t = (1, "a")`: each element of the literal is converted, then the target tuple is built. */
    tupleLiteralConversion(node) {
      const target = node.type,
        types = tupleElements(target),
        conversions = node.conversion.underlying ?? [];
      const pushers = node.operand.elements.map((element, index) => () => {
        this.expression(this.convertedNode(element, conversions[index], types[index].type));
      });
      return this.constructTuple(target, pushers);
    }
    /** A tuple value converted to another tuple type: read each element of a copy, convert it, build the target. */
    tupleValueConversion(node) {
      const source = node.operand.type,
        slot = this.temp(source),
        types = tupleElements(node.type),
        conversions = node.conversion.underlying ?? [];
      this.expression(node.operand);
      this.il.emit('stloc', slot);
      const sources = this.tupleElementSources(source, () => this.il.emit('ldloca', slot));
      const pushers = sources.map((element, index) => () => this.convertedSource(element, conversions[index], types[index].type, node.syntax));
      return this.constructTuple(node.type, pushers);
    }
    /** Pushes the value of a source (`{type, load(), address()}`) converted by a classified conversion. */
    convertedSource(source, conversion, type, syntax) {
      if (!conversion || conversion.kind === 'Identity') return source.load();
      const placeholder = { kind: 'TupleElementPlaceholder', syntax, type: source.type, constantValue: null };
      this.substitutions.set(placeholder, { value: source.load, address: source.address });
      try {
        return this.expression(this.convertedNode(placeholder, conversion, type));
      } finally {
        this.substitutions.delete(placeholder);
      }
    }
    /** `(p1, p2)` over a tuple: each part is an element, read once per run of the tests. */
    positionalParts(pattern, narrowed, pushValue, fail) {
      const positional = pattern.positional;
      if (positional?.kind !== 'tuple') return super.positionalParts(pattern, narrowed, pushValue, fail);
      const sources = this.tupleElementSources(narrowed.type, () => this.il.emit('ldloca', narrowed.slot));
      positional.parts.forEach((part, index) => {
        const slot = this.readOnce(narrowed.slot, 'element:' + index, sources[index].type, sources[index].load);
        this.patternMatch(part.pattern, { slot, type: sources[index].type }, fail);
      });
      return undefined;
    }
    exprBinary(node) {
      if (node.family === 'tuple' && node.operation && !node.method) return this.tupleEquality(node);
      return super.exprBinary(node);
    }
    /**
     * `left == right` over tuples: both operands are evaluated first, left to right, then the elements are compared
     * in order until one decides (`==` stops at the first unequal pair, `!=` at the first that differs).
     */
    tupleEquality(node) {
      const il = this.il,
        { elements, leftParts, rightParts } = node.operation,
        isEquality = node.operator === '==',
        bound = [],
        decided = il.newLabel(),
        end = il.newLabel();
      this.holdTupleOperand(node.left, leftParts, bound);
      this.holdTupleOperand(node.right, rightParts, bound);
      try {
        for (const element of elements) {
          this.expression(element);
          il.emit(isEquality ? 'brfalse' : 'brtrue', decided);
        }
      } finally {
        for (const part of bound) this.substitutions.delete(part);
      }
      il.emit('ldc.i4', isEquality ? 1 : 0).emit('br', end);
      il.mark(decided);
      il.emit('ldc.i4', isEquality ? 0 : 1);
      il.mark(end);
    }
    /**
     * Evaluates one operand of a tuple comparison and makes its parts readable: the elements of a literal are held in
     * temporaries (nested literals too), a tuple value is held once and its parts read its fields.
     * @param {object[]} parts the element expressions (a literal) or placeholders (a value) the comparisons refer to
     * @param {object[]} bound collects the nodes that were given a substitution
     */
    holdTupleOperand(operand, parts, bound) {
      if (operand.kind === 'Tuple' && !this.substitutions.has(operand)) {
        for (const element of operand.elements) this.holdTupleLiteralElement(element, bound);
        return;
      }
      const slot = this.temp(operand.type);
      this.expression(operand);
      this.il.emit('stloc', slot);
      const sources = this.tupleElementSources(operand.type, () => this.il.emit('ldloca', slot));
      parts.forEach((part, index) => {
        this.substitutions.set(part, { value: sources[index].load, address: sources[index].address });
        bound.push(part);
      });
    }
    holdTupleLiteralElement(element, bound) {
      if (this.substitutions.has(element)) return;
      if (element.kind === 'Tuple') {
        for (const nested of element.elements) this.holdTupleLiteralElement(nested, bound);
        return;
      }
      // A constant and a literal without a type (`null`, `default`) have no side effect: they are read where compared.
      if (element.constantValue || !element.type) return;
      const slot = this.temp(element.type);
      this.expression(element);
      this.il.emit('stloc', slot);
      this.substitutions.set(element, { value: () => this.il.emit('ldloc', slot), address: () => this.il.emit('ldloca', slot) });
      bound.push(element);
    }
  };
