/**
 * Arrays beyond `T[]` (SF-A02-T45). The image has single-dimensional arrays only, so:
 *
 *   jagged arrays    `T[][]` is an array whose elements are arrays: nothing to lower.
 *   rank-n arrays    `T[,]` becomes an object of a synthesized class per element type and rank, holding the elements
 *                    in one flat `T[]` in row-major order (the order .NET stores and enumerates them in) and the length
 *                    of every dimension. `a[i, j]` reads `Items[i * Length1 + j]`; an index outside its own dimension
 *                    selects element -1, so the runtime's bounds check raises the IndexOutOfRangeException .NET raises.
 *   members          `Length` is the length of the flat array, `Rank` a constant, `GetLength(d)` the stored length,
 *                    `GetLowerBound(d)` zero and `GetUpperBound(d)` the length minus one; `foreach` walks the flat array.
 *
 * Not lowered (reported as not executable): a dimension argument that is not a constant, an array viewed as
 * System.Array or as an interface, and a conversion between array types with different element types (array
 * covariance): the runtime does not check the element type on a store, so a covariant array would accept anything.
 */
import { ArrayTypeSymbol } from '../symbols/types.js';
import { n } from '../codegen/semantic/node-factory.js';

/** The synthesized classes of rank-n arrays, one per element image type and rank. */
export class MultiDimensionalArrays {
  /** @param {{program: object}} host the generator (its program model declares the classes) */
  constructor(host) {
    this.host = host;
    this.classes = new Map();
  }
  /** `{record, items, lengths}`: the image class, its flat element array field and its per-dimension length fields. */
  classOf(elementType, rank) {
    const key = rank + ':' + elementType;
    let info = this.classes.get(key);
    if (!info) {
      // The name is used as an array element type too (`int[][,]`): the runtime reads `<` and `>` as generic brackets.
      const program = this.host.program,
        record = program.addClass(`$Array${rank}(${elementType.replace(/[<>]/g, '')})`);
      info = {
        record,
        rank,
        items: program.addField(record, 'Items', elementType + '[]'),
        lengths: Array.from({ length: rank }, (_, dimension) => program.addField(record, 'Length' + dimension, 'int')),
      };
      this.classes.set(key, info);
    }
    return info;
  }
}

const isMultiDimensional = type => type instanceof ArrayTypeSymbol && type.rank > 1;
const int = value => n.literal(value, 'int');

/** Class mixin for the body translator: creation, element access, members and enumeration of rank-n arrays. */
export const ArrayTranslation = Base =>
  class extends Base {
    arrayClassOf(type, syntax) {
      return this.g.arrays.classOf(this.imageType(type.elementType, syntax), type.rank);
    }
    exprArrayCreation(node) {
      if (!isMultiDimensional(node.type)) return super.exprArrayCreation(node);
      const info = this.arrayClassOf(node.type, node.syntax),
        elementType = info.items.type.slice(0, -2),
        array = this.temp(info.record.name, 'array'),
        read = () => n.local(array),
        effects = [n.assign(read(), n.allocate(info.record))];
      if (node.elements) {
        // The initializer fixes every length: the count of each nesting level (the binder checked it is rectangular).
        const lengths = [];
        for (let level = node.elements, dimension = 0; dimension < info.rank; level = level[0], dimension++) lengths.push(level?.length ?? 0);
        const flat = node.elements.flat(info.rank - 1).map(element => this.expression(element));
        lengths.forEach((length, dimension) => effects.push(n.assign(n.field(read(), info.lengths[dimension]), int(length))));
        effects.push(n.assign(n.field(read(), info.items), n.newArray(elementType, int(flat.length), flat)));
      } else {
        // Sizes are evaluated left to right, once; the flat array has their product as its length.
        node.sizes.forEach((size, dimension) => effects.push(n.assign(n.field(read(), info.lengths[dimension]), this.expression(size))));
        const total = info.lengths.map(field => n.field(read(), field)).reduce((product, length) => n.binary('*', product, length, 'int'));
        effects.push(n.assign(n.field(read(), info.items), n.newArray(elementType, total)));
      }
      return n.sequence([array], effects, read());
    }
    /**
     * The element of a rank-n array whose array and index operands are already spilled (each can be read repeatedly):
     * an element of the flat array that the emitter can load from and store to.
     */
    flatElement(node) {
      const info = this.arrayClassOf(node.array.type, node.syntax),
        array = () => this.expression(node.array),
        index = dimension => this.expression(node.indices[dimension]),
        length = dimension => n.field(array(), info.lengths[dimension]);
      let inRange = null,
        offset = null;
      for (let dimension = 0; dimension < info.rank; dimension++) {
        const within = n.logicalAnd(n.binary('>=', index(dimension), int(0), 'bool'), n.binary('<', index(dimension), length(dimension), 'bool'));
        inRange = inRange ? n.logicalAnd(inRange, within) : within;
        offset = offset ? n.binary('+', n.binary('*', offset, length(dimension), 'int'), index(dimension), 'int') : index(dimension);
      }
      return n.arrayElement(n.field(array(), info.items), n.conditional(inRange, offset, int(-1), 'int'));
    }
    /** Spills the operands of a rank-n element access and builds `use(element)` after them. */
    withFlatElement(node, use) {
      const sink = { locals: [], effects: [] },
        element = this.flatElement(this.spillOperands(node, sink));
      return n.sequence(sink.locals, sink.effects, use(element));
    }
    isFlatAccess(node) {
      return node.kind === 'ArrayAccess' && isMultiDimensional(node.array.type);
    }
    exprArrayAccess(node) {
      if (!this.isFlatAccess(node)) return super.exprArrayAccess(node);
      return this.withFlatElement(node, element => element);
    }
    exprAssignment(node) {
      if (!this.isFlatAccess(node.left)) return super.exprAssignment(node);
      return this.withFlatElement(node.left, element => n.assign(element, this.expression(node.right)));
    }
    exprCompoundAssignment(node) {
      if (!this.isFlatAccess(node.left) || node.method) return super.exprCompoundAssignment(node);
      return this.withFlatElement(node.left, element =>
        n.compoundAssign(node.operator, element, this.expression(node.right), !!node.isChecked),
      );
    }
    exprIncrement(node) {
      if (!this.isFlatAccess(node.operand) || node.method) return super.exprIncrement(node);
      return this.withFlatElement(node.operand, element => n.increment(node.operator, element, !!node.isPostfix, !!node.isChecked));
    }
    /** A rank-n element as an assignment target of another lowering: its operands must have been spilled by it. */
    target(node) {
      if (!this.isFlatAccess(node)) return super.target(node);
      const spilled = [node.array, ...node.indices].every(operand => operand.kind === 'SpilledOperand');
      return spilled ? this.flatElement(node) : this.unsupported('an element of a multi-dimensional array in this position', node.syntax);
    }
    exprArrayLength(node) {
      const array = node.operand ?? node.array ?? node.receiver,
        type = array.type;
      if (node.member === 'Rank') return n.sequence([], [this.expression(array)], int(type.rank ?? 1));
      if (!isMultiDimensional(type)) return super.exprArrayLength(node);
      return n.arrayLength(n.field(this.expression(array), this.arrayClassOf(type, node.syntax).items));
    }
    exprCall(node) {
      const member = (node.method.originalDefinition ?? node.method).arrayMember;
      if (!member || !(node.receiver?.type instanceof ArrayTypeSymbol)) return super.exprCall(node);
      const type = node.receiver.type,
        dimension = node.args[0]?.expression?.constantValue?.value;
      if (typeof dimension !== 'number' || dimension < 0 || dimension >= type.rank)
        return this.unsupported(`'${member}' with a dimension that is not a constant within the rank`, node.syntax);
      if (member === 'GetLowerBound') return n.sequence([], [this.expression(node.receiver)], int(0));
      const receiver = this.expression(node.receiver),
        length = isMultiDimensional(type)
          ? n.field(receiver, this.arrayClassOf(type, node.syntax).lengths[dimension])
          : n.arrayLength(receiver);
      return member === 'GetLength' ? length : n.binary('-', length, int(1), 'int');
    }
    exprConversion(node) {
      const from = node.operand?.type,
        to = node.type;
      if (from instanceof ArrayTypeSymbol && to && !node.operand.literal) {
        if (to instanceof ArrayTypeSymbol) {
          const same = from.rank === to.rank && this.imageType(from, node.syntax) === this.imageType(to, node.syntax);
          if (!same) return this.unsupported('array covariance (the runtime does not check the element type of a store)', node.syntax);
        } else if (to.specialType !== 'System_Object')
          return this.unsupported(`an array viewed as '${to.toDisplayString()}'`, node.syntax);
      }
      return super.exprConversion(node);
    }
    stmtForEach(node) {
      const type = node.collection?.type;
      if (!node.local || !isMultiDimensional(type)) return super.stmtForEach(node);
      // The elements are enumerated in row-major order, which is the order of the flat array.
      const info = this.arrayClassOf(type, node.syntax),
        collection = this.lowered(node.collection, () => n.field(this.expression(node.collection), info.items));
      collection.type = this.g.analysis.core.arrayOf(type.elementType);
      return super.stmtForEach({ ...node, collection });
    }
  };
