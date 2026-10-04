/**
 * Binding of a call in expanded form whose `params` parameter is not an array (C# 13, SF-A02-T81).
 *
 * Overload resolution (overload/params-collections.js) decides applicability and betterness on the element type.
 * Here the trailing arguments of the chosen call are packed into one collection value, built from nodes the
 * existing lowering already runs, and the call continues in normal form with that value as its last argument:
 *
 *   collection   new C() with one `Add(element)` per argument      a collection-initializer object creation
 *   IEnumerable<T>, IReadOnlyCollection<T>, IReadOnlyList<T>       a T[] converted to the interface
 *   ICollection<T>, IList<T>                                       a List<T> converted to the interface
 *   Span<T>, ReadOnlySpan<T>                                       a T[] converted to the span
 *
 * The same collections Roslyn creates, except that Roslyn may use a synthesized read-only list for the read-only
 * interfaces and the stack for spans; the elements and their order are the same.
 */
import { SymbolKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { paramsCollectionShape, mutableInterfaceNames } from '../overload/params-collections.js';

/** Binder mixin: packs the arguments of an expanded params-collection call. */
export const ParamsCollectionBinding = Base =>
  class extends Base {
    finishCall(result, receiver, args, syntax, options) {
      const packed = result.expanded ? this.packParamsCollection(result, args, syntax) : null;
      if (!packed) return super.finishCall(result, receiver, args, syntax, options);
      return super.finishCall(packed.result, receiver, packed.args, syntax, options);
    }
    /** An indexer with a params collection: its bound arguments are packed the same way. */
    elementAccessOn(target, args, syntax) {
      const node = super.elementAccessOn(target, args, syntax);
      if (node.kind !== 'IndexerAccess' || !node.expanded) return node;
      const parameters = node.property.parameters,
        last = parameters.length - 1,
        type = parameters[last].type,
        shape = paramsCollectionShape(type);
      if (!shape || shape.kind === 'array') return node;
      const positions = node.mapping.parameterOf,
        elements = node.args.filter((_, i) => positions[i] === last).map(a => Object.assign(a.expression, { refKind: null, name: null })),
        collection = this.paramsCollectionValue(type, shape, elements, syntax);
      node.args = [...node.args.filter((_, i) => positions[i] !== last), { expression: collection, parameter: parameters[last] }];
      node.mapping = { ...node.mapping, expanded: false, paramsCount: 0, parameterOf: [...positions.filter(p => p !== last), last] };
      node.expanded = false;
      return node;
    }
    /** The call in normal form with its params arguments packed, or null for a params array (packed by lowering). */
    packParamsCollection(result, args, syntax) {
      const parameters = result.method.parameters,
        last = parameters.length - 1,
        type = parameters[last].type,
        shape = paramsCollectionShape(type);
      if (!shape || shape.kind === 'array') return null;
      const positions = result.mapping.parameterOf,
        kept = args.map((_, i) => i).filter(i => positions[i] !== last),
        elements = args
          .map((argument, i) => ({ argument, i }))
          .filter(({ i }) => positions[i] === last)
          .map(({ argument, i }) => {
            const conversion = result.conversions[i],
              converts = conversion && !argument.hasErrors && (argument.type || argument.materialize || argument.literal === 'default');
            const value = converts ? this.applyConversion(argument, shape.element, conversion, argument.syntax) : argument;
            if (argument.form === 'lambda' && !argument.hasErrors) this.finishLambda(argument, shape.element);
            return Object.assign(value.hasErrors ? { ...value } : value, { refKind: null, name: null });
          });
      const collection = Object.assign(this.paramsCollectionValue(type, shape, elements, syntax), { refKind: null, name: null });
      return {
        args: [...kept.map(i => args[i]), collection],
        result: {
          ...result,
          expanded: false,
          mapping: { ...result.mapping, expanded: false, paramsCount: 0, parameterOf: [...kept.map(i => positions[i]), last] },
          conversions: [...kept.map(i => result.conversions[i]), new Conversion(ConversionKind.Identity)],
          parameterTypes: [...kept.map(i => result.parameterTypes[i]), type],
        },
      };
    }
    paramsCollectionValue(type, shape, elements, syntax) {
      const reference = operand => this.applyConversion(operand, type, new Conversion(ConversionKind.ImplicitReference), syntax);
      if (shape.kind === 'collection') return this.paramsCollectionCreation(type, elements, syntax);
      if (shape.kind === 'interface' && mutableInterfaceNames.has((type.originalDefinition ?? type).name)) {
        const list = this.wellKnownListOf(shape.element);
        if (list) return reference(this.paramsCollectionCreation(list, elements, syntax));
      }
      const array = this.node('ArrayCreation', syntax, this.core.arrayOf(shape.element, 1), { sizes: [], elements });
      return shape.kind === 'span' ? this.convert(array, type, syntax) : reference(array);
    }
    /** `new C()` followed by `Add(element)` for each element, in the shape of a collection initializer. */
    paramsCollectionCreation(type, elements, syntax) {
      const constructors = type
        .getMembers('.ctor')
        .filter(member => member.kind === SymbolKind.Method && member.methodKind === MethodKind.Constructor && !member.isStatic);
      const resolved = constructors.length ? this.d.overloads.resolve(constructors, [], { isConstructor: true }) : null,
        creation = this.node('ObjectCreation', syntax, type, {
          constructor: resolved?.succeeded ? resolved.method : null,
          args: [],
          expanded: false,
          mapping: resolved?.succeeded ? resolved.mapping : null,
        });
      creation.initializers = [];
      creation.collectionInitializers = elements.map(element => this.addCall(type, [element], element.syntax ?? syntax, syntax)).filter(Boolean);
      return creation;
    }
    /** `System.Collections.Generic.List<element>`, or null when the references do not have it. */
    wellKnownListOf(element) {
      let namespace = this.d.globalNamespace;
      for (const part of ['System', 'Collections', 'Generic']) namespace = namespace?.getNamespace(part);
      const definition = namespace?.getTypeMembers('List', 1)[0];
      return definition ? definition.construct(element) : null;
    }
  };
