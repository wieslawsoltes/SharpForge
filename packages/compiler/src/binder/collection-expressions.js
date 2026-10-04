/**
 * Collection expressions (SF-A02-T79, C# 12): `[a, b, ..c]` has no type of its own and converts to
 *
 *   - a single-dimensional array `T[]`;
 *   - a type that implements IEnumerable, has an accessible parameterless constructor and an `Add` method
 *     (`List<T>`, `HashSet<T>`, a class written in source);
 *   - `IEnumerable<T>`, `IReadOnlyCollection<T>`, `IReadOnlyList<T>`, `ICollection<T>`, `IList<T>` (a `List<T>`);
 *   - `Span<T>` and `ReadOnlySpan<T>`;
 *
 * when every element converts to the element type `T` and every spread element can be enumerated with an iteration
 * type that converts to `T`. Diagnostics: CS9176 (no target type), CS9174 (the target is not one of the above),
 * CS0029 and friends on the element that does not convert, CS1579 on a spread that cannot be enumerated.
 *
 * The conversion is materialized as constructs later passes already know: an array creation with elements, or an
 * object creation with a collection initializer - `Add(value)` per element and `AddRange(array)` per spread - followed
 * by `ToArray()` when the target is an array. A span target, a `[CollectionBuilder]` type and a spread that cannot be
 * appended that way keep the collection node, which code generation reports as not executable (SF2200).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, ArrayTypeSymbol, NamedTypeSymbol } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { implementsInterface, findConstruction } from '../symbols/substitution.js';
import { attributesNamed } from './bound-attributes.js';
import { lookupMembers } from './inheritance.js';
import { isSourceSymbol } from '../semantic/analysis-helpers.js';

const collectionBuilderAttribute = 'System.Runtime.CompilerServices.CollectionBuilderAttribute';
const isSpan = type => type instanceof NamedTypeSymbol && ['Span', 'ReadOnlySpan'].includes(type.name) && type.typeArguments.length === 1;

/** Class mixin of the body binder: collection expressions. */
export const CollectionExpressionBinding = Base =>
  class extends Base {
    collectionExpression(syntax) {
      const elements = [];
      let withArguments = null;
      for (const [index, element] of syntax.elements.entries()) {
        if (element.kind === 'ExpressionElement') elements.push({ value: this.value(element.expression), syntax: element });
        else if (element.kind === 'SpreadElement') elements.push({ spread: this.value(element.expression), syntax: element });
        // `with(...)` arguments (C# 15 preview): ./collection-arguments.js.
        else if (element.kind === 'WithElement' && this.collectionArguments) withArguments = this.collectionArguments(element, index) ?? withArguments;
        else return this.lenient(syntax);
      }
      const node = this.node('CollectionExpression', syntax, null, { elements, form: 'collection', withArguments });
      node.convert = to => {
        const target = this.collectionTarget(to);
        return target && elements.every(element => this.elementConverts(element, target.elementType))
          ? new Conversion(ConversionKind.CollectionExpression)
          : null;
      };
      node.materialize = to => this.materializeCollection(node, to);
      return node;
    }
    /** The interface types a collection expression converts to, as definitions. */
    get collectionInterfaces() {
      const core = this.core;
      return [core.ienumerableT, core.ireadOnlyCollectionT, core.ireadOnlyListT, core.icollectionT, core.ilistT];
    }
    /**
     * How a collection expression becomes a value of type `to`: `{kind, elementType}` with kind 'array', 'collection',
     * 'interface', 'span' or 'builder'; null when `to` is not a collection type.
     */
    collectionTarget(to) {
      if (!to || to.isErrorType()) return null;
      if (to instanceof ArrayTypeSymbol) return to.rank === 1 ? { kind: 'array', elementType: to.elementType } : null;
      if (!(to instanceof NamedTypeSymbol)) return null;
      const single = to.typeArguments.length === 1 ? to.typeArguments[0].type : null,
        definition = to.originalDefinition ?? to;
      if (isSpan(to)) return { kind: 'span', elementType: single };
      if (to.typeKind === TypeKind.Interface)
        return single && this.collectionInterfaces.includes(definition) ? { kind: 'interface', elementType: single } : null;
      if (to.typeKind !== TypeKind.Class && to.typeKind !== TypeKind.Struct) return null;
      if (to.specialType === 'System_String') return null;
      // The registry does not list the interfaces of framework collections: there, an `Add` method marks one.
      const isEnumerable = implementsInterface(to, this.core.ienumerable, this.core),
        adds = isSourceSymbol(to) ? [] : to.getMembers('Add').filter(member => member.kind === SymbolKind.Method),
        add = adds.find(member => member.parameters.length === 1);
      if (!isEnumerable && !adds.length) return null;
      const generic = findConstruction(to, this.core.ienumerableT, this.core),
        elementType = generic ? generic.typeArguments[0].type : (add?.parameters[0].type ?? this.core.object);
      // A framework collection whose `Add` takes two arguments (a dictionary) can be created empty, not filled (CS9215).
      const lacksElementAdd = !isSourceSymbol(to) && adds.length > 0 && !add;
      return { kind: attributesNamed(definition, collectionBuilderAttribute).length ? 'builder' : 'collection', elementType, lacksElementAdd };
    }
    /** The iteration type of a spread operand, or null when it cannot be enumerated (or is not known). */
    spreadElementType(spread) {
      const type = spread.type;
      if (!type || type.isErrorType()) return null;
      if (type instanceof ArrayTypeSymbol) return type.elementType;
      if (type.specialType === 'System_String') return this.core.char;
      const generic = findConstruction(type, this.core.ienumerableT, this.core);
      if (generic) return generic.typeArguments[0].type;
      if (implementsInterface(type, this.core.ienumerable, this.core)) return this.core.object;
      // The registry does not list the interfaces of framework collections: a single type argument is their element.
      return !isSourceSymbol(type) && !type.specialType && type.typeArguments?.length === 1 ? type.typeArguments[0].type : null;
    }
    elementConverts(element, elementType) {
      if (element.spread) {
        const iteration = element.spread.hasErrors ? null : this.spreadElementType(element.spread);
        return !iteration || this.conversions.classifyImplicit(iteration, elementType).exists;
      }
      if (element.value.hasErrors) return true;
      const conversion = this.conversions.classifyFromExpression(element.value, elementType);
      return conversion.exists && conversion.isImplicit;
    }
    /** Why a collection expression does not convert to `type`: the target, or the elements that do not fit it. */
    reportCollectionFailure(node, type) {
      const target = this.collectionTarget(type);
      if (!target) {
        this.report(node.syntax, DiagnosticId.CS9174, [this.display(type)]);
        return;
      }
      for (const element of node.elements) {
        if (this.elementConverts(element, target.elementType)) continue;
        if (element.spread) {
          const iteration = this.spreadElementType(element.spread);
          this.report(element.syntax.expression, DiagnosticId.CS0029, [this.display(iteration), this.display(target.elementType)]);
        }
        else this.convert(element.value, target.elementType);
      }
    }
    materializeCollection(node, to) {
      const syntax = node.syntax,
        target = this.collectionTarget(to),
        hasSpread = node.elements.some(element => element.spread);
      // Arguments the target does not take are reported and then left out of the construction.
      if (node.withArguments && !this.checkCollectionArguments(node, to, target)) node = { ...node, withArguments: null };
      if (target.lacksElementAdd && node.elements.length) {
        this.report(syntax, DiagnosticId.CS9215, [this.display(to)]);
        return this.bad(syntax);
      }
      for (const element of node.elements)
        if (element.spread && !element.spread.hasErrors && !this.spreadElementType(element.spread) && element.spread.type)
          this.report(element.syntax.expression, DiagnosticId.CS9212, [this.display(element.spread.type), 'GetEnumerator']);
      const converted = element => this.convert(element.value, target.elementType, element.syntax.expression);
      if (target.kind === 'array' && !hasSpread)
        return this.node('ArrayCreation', syntax, to, { elements: node.elements.map(converted), isCollectionExpression: true });
      // Everything else is built in a collection: the target itself, or a List<T> for an array or an interface.
      const builtIn = target.kind === 'collection' ? to : target.kind === 'span' || target.kind === 'builder' ? null : this.listOf(target.elementType),
        built = builtIn && this.constructibleCollection(builtIn, node) ? this.collectionCreation(builtIn, node, target) : null;
      if (built?.hasErrors) return built;
      if (built && target.kind === 'collection') return built;
      if (built && target.kind === 'interface')
        return this.node('Conversion', syntax, to, {
          operand: built,
          conversion: new Conversion(ConversionKind.ImplicitReference),
          isCollectionExpression: true,
        });
      const array = built && target.kind === 'array' ? this.receiverCall(builtIn, 'ToArray', [], syntax, built) : null;
      if (array) return array;
      // Spans, builder types and spreads that cannot be appended keep the collection node: code generation names them.
      const elements = node.elements.map(element => (element.spread ? element : { ...element, value: converted(element) }));
      return this.node('CollectionExpression', syntax, to, { elements, target });
    }
    /** CS9214 / CS1061 / CS9215 for a source type that cannot be built: no parameterless constructor or no usable `Add`. */
    constructibleCollection(type, node) {
      if (!isSourceSymbol(type)) return true;
      const constructors = type.getMembers('.ctor').filter(member => member.methodKind === MethodKind.Constructor),
        adds = lookupMembers(type, 'Add', this.core, { within: this.c.containingType }).members.filter(m => m.kind === SymbolKind.Method);
      // With a `with(...)` element any accessible constructor will do: overload resolution on its arguments decides.
      const needsParameterless = !node.withArguments;
      if (needsParameterless && constructors.length && !constructors.some(constructor => constructor.parameters.every(p => p.isOptional || p.isParams))) {
        this.report(node.syntax, DiagnosticId.CS9214);
        return false;
      }
      if (!adds.length) this.report(node.syntax, DiagnosticId.CS1061, [this.display(type), 'Add']);
      else if (!adds.some(add => add.parameters.length === 1)) this.report(node.syntax, DiagnosticId.CS9215, [this.display(type)]);
      else return true;
      return false;
    }
    /**
     * `new C()` with one call per element as its collection initializer: `Add(value)`, and for a spread
     * `AddRange(array)` (a spread that is not an array is turned into one with its `ToArray()`).
     * @returns the creation, a node with errors, or null when a spread cannot be appended this way
     */
    collectionCreation(type, node, target) {
      const withArguments = node.withArguments,
        creation = this.create(type, withArguments?.args ?? [], node.syntax, withArguments?.syntax ?? node.syntax, null);
      if (creation.hasErrors || creation.kind !== 'ObjectCreation') return creation.hasErrors ? creation : null;
      const receiver = this.implicitReceiver(node.syntax, type),
        argument = value => Object.assign(value.hasErrors ? { ...value } : value, { refKind: null, name: null }),
        calls = [];
      for (const element of node.elements) {
        const at = element.syntax;
        let call;
        if (element.spread) {
          const spread = element.spread,
            array = spread.type instanceof ArrayTypeSymbol ? spread : this.receiverCall(spread.type, 'ToArray', [], at, spread);
          // A spread without `ToArray()` (an iterator, an interface) is appended as the sequence it is.
          call = this.receiverCall(type, 'AddRange', [argument(array ?? spread)], at, receiver);
          if (!call) return null;
        } else {
          // A collection of a source type takes the element as written: `Add` decides the conversion.
          const value = target.kind === 'collection' ? element.value : this.convert(element.value, target.elementType, at.expression);
          call = value.hasErrors ? null : this.addCall(type, [argument(value)], at, node.syntax);
        }
        if (call && !call.hasErrors) calls.push(call);
      }
      return { ...creation, collectionInitializers: calls, isCollectionExpression: true };
    }
    /** `receiver.name(values)` for an instance method of `type`, or null when no overload applies. */
    receiverCall(type, name, values, syntax, receiver) {
      if (!type || type.isErrorType()) return null;
      const methods = lookupMembers(type, name, this.core, { within: this.c.containingType }).members.filter(
          member => member.kind === SymbolKind.Method && !member.isStatic,
        ),
        result = methods.length ? this.d.overloads.resolve(methods, values, { name }) : null;
      return result?.succeeded ? this.finishCall(result, receiver, values, syntax, {}) : null;
    }
    /** `System.Collections.Generic.List<elementType>`, or null when the framework has no such type. */
    listOf(elementType) {
      let scope = this.d.globalNamespace;
      for (const part of ['System', 'Collections', 'Generic']) scope = scope?.getNamespace(part);
      const list = scope?.getTypeMembers('List', 1)[0];
      return list ? list.construct(elementType) : null;
    }
  };
