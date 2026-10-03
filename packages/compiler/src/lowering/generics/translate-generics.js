/**
 * Lowering of the constructs whose meaning depends on a type argument (SF-A02-T02.6): the translator half of
 * monomorphization. A generic body is lowered once per construction, so what .NET decides at run time from the type
 * argument is decided here from the closed type:
 *
 *   t.Member(...)  on a `T` constrained to an interface   ->  the implementing member of the closed type, called directly
 *   T.Member(...), T.Property, a + b through a static     ->  the static member or operator of the closed type that
 *     abstract member of an interface T is constrained to       implements it, called directly
 *   new T()                                               ->  creation of the closed type with its parameterless constructor
 *   default(T), T locals, T[]                             ->  the closed type (the type mapper closes every type it maps)
 *
 * Refused (SF2200) instead of miscompiled: converting a construction to `object` or calling an `object` member on
 * it - its run-time type name is the synthesized one, not `Box`1[System.Int32]` - and members that only dispatch
 * could reach (default interface members, explicit implementations inside a generic class).
 */
import { TypeKind, SymbolKind, ConstructedNamedTypeSymbol } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { findImplementation } from '../../binder/interface-impl.js';
import { constrainedTypeParameter } from '../../overload/interface-operators.js';
import { n } from '../../codegen/semantic/node-factory.js';

const toObjectConversions = new Set(['Boxing', 'ImplicitReference', 'Identity']);

/** Class mixin for the body translator. */
export const GenericTranslation = Base =>
  class extends Base {
    /** The closed form of a bound node's type under the construction being lowered. */
    closedType(type) {
      return this.g.generics.close(type);
    }
    isTypeParameter(type) {
      return type?.typeKind === TypeKind.TypeParameter;
    }
    /**
     * True for a construction whose run-time type name is not the .NET one: a closed construction of a source generic
     * class (its image class has a synthesized name) or a framework generic that shares the construction over `object`.
     */
    isConstruction(type) {
      const closed = this.closedType(type);
      if (!closed) return false;
      return this.g.generics.isGenericClass(closed) || !!this.g.frameworkConstructions.registryConstruction(closed)?.erased;
    }
    /**
     * The member of the closed receiver type that a member reached through a type parameter stands for, as a symbol
     * the generator can look up. `member` is declared by an interface, a constraint class or `object`.
     */
    memberOfClosedReceiver(member, receiverType, syntax) {
      const closed = this.g.generics.closed(receiverType, syntax),
        declaring = member.containingType;
      if (!declaring || declaring.typeKind !== TypeKind.Interface) return member;
      const iface = this.closedType(declaring),
        definition = member.originalDefinition ?? member,
        seen = iface instanceof ConstructedNamedTypeSymbol ? iface.getMembers(member.name).find(m => m.originalDefinition === definition) : definition;
      const found = seen ? findImplementation(closed, iface, seen, this.g.analysis.core) : null;
      if (!found?.member) {
        return this.unsupported(`'${member.toDisplayString()}' on '${closed.toDisplayString()}' (it needs interface dispatch)`, syntax);
      }
      return found.member;
    }
    /**
     * The image method of a generic local function for closed type arguments, declared on first use. The function is
     * declared like any local function, with its type parameters bound, so its body is queued under that substitution.
     */
    genericLocalFunction(symbol, typeArguments, syntax) {
      const root = this.frame.root,
        generics = this.g.generics,
        key = generics.argumentsKey(typeArguments);
      root.genericLocalFunctions ??= new Map();
      let constructions = root.genericLocalFunctions.get(symbol);
      if (!constructions) root.genericLocalFunctions.set(symbol, (constructions = new Map()));
      let entry = constructions.get(key);
      if (entry) return entry;
      if (constructions.size >= 256) return this.unsupported('a generic instantiation that does not terminate', syntax);
      const outer = root.localFunctions.get(symbol);
      root.localFunctions.delete(symbol);
      try {
        generics.withMap(generics.active.with(symbol.typeParameters, typeArguments), () => this.declareLocalFunction(symbol));
        entry = root.localFunctions.get(symbol);
      } finally {
        if (outer) root.localFunctions.set(symbol, outer);
        else root.localFunctions.delete(symbol);
      }
      if (!entry) return this.unsupported(`local function '${symbol.name}' in this position`, syntax);
      constructions.set(key, entry);
      return entry;
    }
    callLocalFunctionEntry(entry, args) {
      return n.call(entry.method, null, [...args, ...this.extraArguments(entry)]);
    }
    exprCall(node) {
      const receiverType = node.receiver?.type,
        method = node.method;
      if (method?.methodKind === MethodKind.LocalFunction && method.typeArguments?.length) {
        const definition = method.originalDefinition ?? method;
        if (definition.typeParameters?.length) {
          const typeArguments = method.typeArguments.map(argument => this.g.generics.closed(argument, node.syntax)),
            entry = this.genericLocalFunction(definition, typeArguments, node.syntax);
          return this.callLocalFunctionEntry(entry, this.arguments(node, method));
        }
      }
      // `T.Member(...)`: a static abstract member of a constraint interface, implemented by the closed type.
      if (method?.kind === SymbolKind.Method && !receiverType && this.isTypeParameter(node.constrainedTo)) {
        const target = this.memberOfClosedReceiver(method, node.constrainedTo, node.syntax);
        if (target !== method) return this.g.generics.withClosedTarget(() => super.exprCall({ ...node, method: target, constrainedTo: null }));
      }
      if (method?.kind === SymbolKind.Method && method.methodKind !== MethodKind.LocalFunction && receiverType) {
        if (this.isTypeParameter(receiverType)) {
          const target = this.memberOfClosedReceiver(method, receiverType, node.syntax);
          // The target was chosen from the closed receiver type: what it asks for is not written in this body.
          if (target !== method) return this.g.generics.withClosedTarget(() => super.exprCall({ ...node, method: target }));
        }
        if (this.isConstruction(receiverType) && !this.g.isSource(method) && !this.isFrameworkGenericMember(method))
          return this.unsupported(`'${method.toDisplayString()}' on a constructed generic type`, node.syntax);
      }
      return super.exprCall(node);
    }
    exprPropertyAccess(node) {
      const closed = this.closedProperty(node);
      return closed === node ? super.exprPropertyAccess(node) : this.g.generics.withClosedTarget(() => super.exprPropertyAccess(closed));
    }
    propertyReference(node) {
      const closed = this.closedProperty(node);
      return closed === node ? super.propertyReference(node) : this.g.generics.withClosedTarget(() => super.propertyReference(closed));
    }
    /** A property read or written through a type parameter, rebound to the property of the closed type. */
    closedProperty(node) {
      const receiverType = node.receiver?.type ?? node.constrainedTo;
      if (!receiverType || !this.isTypeParameter(receiverType) || !node.property) return node;
      const target = this.memberOfClosedReceiver(node.property, receiverType, node.syntax);
      return target === node.property ? node : { ...node, property: target };
    }
    /** `new T()`: the closed type decides what is created. */
    exprObjectCreation(node) {
      if (!this.isTypeParameter(node.type)) return super.exprObjectCreation(node);
      const closed = this.g.generics.closed(node.type, node.syntax);
      if (closed.typeKind !== TypeKind.Class || !this.g.isSource(closed)) return this.creationOfClosedType(node, closed);
      const constructor = closed.getMembers('.ctor').find(c => c.methodKind === MethodKind.Constructor && !c.isStatic && !c.parameters.length);
      return super.exprObjectCreation({ ...node, type: closed, constructor: constructor ?? null });
    }
    /** `new T()` where T is not a source class: a primitive has its default value, anything else is not creatable here. */
    creationOfClosedType(node, closed) {
      const imageType = this.imageType(closed, node.syntax);
      if (!this.types.isReference(imageType)) return this.defaultValue(imageType);
      return this.unsupported(`creating '${closed.toDisplayString()}' through a type parameter`, node.syntax);
    }
    /**
     * An operator node whose method is a static abstract operator of an interface, reached through the type parameter
     * of an operand: the same node with the operator of the closed type that implements it.
     */
    closedOperator(node, operandTypes) {
      const through = node.method ? constrainedTypeParameter(node.method, operandTypes, this.g.analysis.core) : null;
      if (!through) return node;
      const target = this.memberOfClosedReceiver(node.method, through, node.syntax);
      return target === node.method ? node : { ...node, method: target };
    }
    exprUnary(node) {
      const closed = this.closedOperator(node, [node.operand?.type]);
      return closed === node ? super.exprUnary(node) : this.g.generics.withClosedTarget(() => super.exprUnary(closed));
    }
    /** `++x` / `x--` through a static abstract operator (lowering/members/operators.js computes the stepped value). */
    stepped(node, value, type) {
      const closed = this.closedOperator(node, [node.operand?.type]);
      return closed === node ? super.stepped(node, value, type) : this.g.generics.withClosedTarget(() => super.stepped(closed, value, type));
    }
    /** True for a reference conversion of a construction to `object`. */
    isConstructionToObject(node) {
      return (
        node?.kind === 'Conversion' &&
        toObjectConversions.has(node.conversion?.kind) &&
        node.type?.specialType === 'System_Object' &&
        this.isConstruction(node.operand?.type)
      );
    }
    exprConversion(node) {
      if (this.isConstructionToObject(node)) {
        return this.unsupported("converting a constructed generic type to 'object' (its run-time type name is synthesized)", node.syntax);
      }
      return super.exprConversion(node);
    }
    /** Reference equality compares the objects themselves: the conversions of its operands to `object` are dropped. */
    exprBinary(node) {
      const closed = this.closedOperator(node, [node.left?.type, node.right?.type]);
      if (closed !== node) return this.g.generics.withClosedTarget(() => super.exprBinary(closed));
      if ((node.operator !== '==' && node.operator !== '!=') || node.method) return super.exprBinary(node);
      const operand = side => (this.isConstructionToObject(side) ? side.operand : side);
      const left = operand(node.left),
        right = operand(node.right);
      return super.exprBinary(left === node.left && right === node.right ? node : { ...node, left, right });
    }
    /**
     * `await` of a task whose construction is shared with `Task<object>`: the contract yields `object`, and the CIL
     * emitter types the stack from the contract. The result goes through a temporary of its own image type, so a
     * member access on it resolves against the right class.
     */
    exprAwait(node) {
      const value = super.exprAwait(node),
        task = this.closedType(node.operand?.type),
        shared = task ? this.g.frameworkConstructions.registryConstruction(task) : null;
      if (!shared?.erased || value.legacyType === 'object') return value;
      const result = this.temp(value.legacyType, 'awaited');
      return n.sequence([result], [n.assign(n.local(result), value)], n.local(result));
    }
    /**
     * In generic code a branch that a constant condition rules out is not lowered, as Roslyn does not emit it: it
     * would ask for constructions .NET never creates (a recursive call with a larger type argument behind a
     * constant that is false).
     */
    stmtIf(node) {
      const constant = node.condition?.constantValue;
      if (this.g.generics.active.isEmpty || typeof constant?.value !== 'boolean') return super.stmtIf(node);
      const live = constant.value ? node.then : node.otherwise;
      return live ? this.embedded(live) : n.noOp();
    }
    exprInterpolatedString(node) {
      for (const part of node.parts ?? []) {
        if (this.isConstruction(part.type)) return this.unsupported('formatting a value of a constructed generic type', part.syntax ?? node.syntax);
      }
      return super.exprInterpolatedString(node);
    }
  };
