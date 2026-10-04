/**
 * Lookup of C# 14 extension members (SF-A02-T83).
 *
 * The symbols come from source blocks or imported grouping/marker metadata: every extension block member is a static
 * implementation method of its class. Instance extension methods need nothing here - they are classic extension
 * methods and the existing lookup finds them. This module adds what a classic extension method cannot express:
 *
 *   receiver.P            an instance extension property: bound as `PropertyAccess` whose accessors are the static
 *                         implementations and whose receiver is converted to the extension parameter
 *   Type.M(args), Type.P  static extension members: the implementations whose block extends `Type`
 *   a + b, -a, a++        extension operators: the `op_*` implementations in scope, when the operand types declare
 *                         no applicable operator and no predefined operator applies
 *
 * A member of the type itself always wins: both lookups run only after the ordinary member lookup found nothing.
 * Scopes are searched like extension methods, innermost first; the first scope with an applicable member decides,
 * and applicable properties of one scope compete by the better receiver conversion; a tie is CS9339.
 *
 * The type arguments of a generic block are inferred from the receiver (an instance member, through overload
 * resolution on its get accessor) or unified with the named type (a static member).
 *
 * Limits: write-only extension properties are not found (the receiver is inferred through the get accessor); a
 * static extension method that declares type parameters of its own inside a generic block is not found; instance
 * (compound assignment) extension operators are not bound.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { PropertySymbol } from '../symbols/members.js';
import { canDeclareExtensions, extensionClassesIn, isValidReceiverConversion } from '../overload/extension-methods.js';
import { ConversionKind } from '../conversions/classify.js';
import { binaryOperatorNames, unaryOperatorNames } from '../overload/operators.js';
import { lookupMembers } from './inheritance.js';

/** The extension members a class declares (building its members on first use). */
function extensionMembersOf(type) {
  if (type.mightContainExtensionMethods === false || !canDeclareExtensions(type)) return [];
  type.getMembers();
  return type.extensionMembers ?? [];
}

/**
 * The extension members named `name` that are visible at a call site, one list per scope, innermost first.
 * @param chain the enclosing namespace declarations with their using directives (see `extensionScopes`)
 */
export function extensionMemberScopes(chain, name, kind) {
  const named = types => types.flatMap(extensionMembersOf).filter(entry => entry.name === name && entry.kind === kind),
    scopes = [];
  for (const level of chain) {
    if (level.namespace) scopes.push(named(extensionClassesIn(level.namespace)));
    const imported = [...(level.usings?.namespaces ?? []).flatMap(extensionClassesIn), ...(level.usings?.staticTypes ?? [])];
    scopes.push(named([...new Set(imported)]));
  }
  return scopes.filter(scope => scope.length);
}

/** Structural match of `pattern` (which may mention `parameters`) against `actual`; fills `map` parameter -> type. */
function unify(pattern, actual, parameters, map) {
  if (pattern.typeKind === TypeKind.TypeParameter && parameters.includes(pattern)) {
    const known = map.get(pattern);
    if (known) return known.equals(actual);
    map.set(pattern, actual);
    return true;
  }
  if (pattern.elementType && actual.elementType) return pattern.rank === actual.rank && unify(pattern.elementType, actual.elementType, parameters, map);
  const left = pattern.typeArguments ?? [],
    right = actual.typeArguments ?? [];
  if (!left.length || pattern.originalDefinition !== actual.originalDefinition || left.length !== right.length) return pattern.equals(actual);
  return left.every((argument, i) => unify(argument.type, right[i].type, parameters, map));
}

/** A copy of an extension property over constructed accessors (the block's type arguments are known at the use). */
function constructedProperty(definition, getMethod, setMethod, receiverType) {
  const typed = getMethod ? getMethod.returnTypeWithAnnotations : setMethod.parameters.at(-1).typeWithAnnotations,
    property = new PropertySymbol({
      name: definition.name,
      type: typed,
      containingSymbol: definition.containingSymbol,
      declaredAccessibility: definition.declaredAccessibility,
      modifiers: definition.modifiers,
      locations: definition.locations,
      syntax: definition.syntax,
    });
  property._original = definition;
  property.getMethod = getMethod;
  property.setMethod = setMethod;
  property.isExtensionProperty = true;
  property.extensionReceiverType = receiverType;
  return property;
}

/** Binder mixin: extension properties and static extension members. */
export const ExtensionMemberBinding = Base =>
  class extends Base {
    extensionMemberScopes(name, kind) {
      const chain = this.typeScope.namespaceChain.map(level => ({
        namespace: level.namespace,
        usings: level.scope.usings ? this.d.typeBinder.usingsOf(level.scope) : null,
      }));
      return extensionMemberScopes(chain, name, kind);
    }
    /** `receiver.Name` where the type of the receiver has no member `Name`: an instance extension property. */
    instanceExtensionMember(left, type, name, syntax, typeArguments, options) {
      if (typeArguments) return null;
      const found = this.applicableExtensionProperty(name, left);
      if (found) {
        if (options.nameofOperand) {
          this.report(syntax, DiagnosticId.CS9316);
          return this.bad(syntax);
        }
        if (!found.property) {
          this.report(syntax, DiagnosticId.CS9339, found.ambiguous.slice(0, 2).map(candidate => candidate.toDisplayString()));
          return this.bad(syntax);
        }
        const receiver = this.convert(left, found.property.extensionReceiverType, left.syntax);
        return this.memberResult([found.property], syntax, receiver, type, name, null, options);
      }
      // A static extension member reached through a value: Roslyn names the receiver (CS0176).
      for (const scope of this.extensionMemberScopes(name, 'static')) {
        const member = scope.map(entry => this.staticExtensionFor(entry.symbol, type)).find(Boolean);
        if (!member) continue;
        this.report(left.syntax, DiagnosticId.CS0176, [member.toDisplayString()]);
        return this.bad(syntax);
      }
      return null;
    }
    /**
     * The instance extension property `name` for `receiver`, from the nearest scope that has an applicable one.
     * @returns {null|{property:object}|{property:null,ambiguous:object[]}}
     */
    applicableExtensionProperty(name, receiver) {
      for (const scope of this.extensionMemberScopes(name, 'instance')) {
        const applicable = scope
          .filter(entry => entry.symbol.kind === SymbolKind.Property)
          .map(entry => this.extensionPropertyFor(entry.symbol, receiver))
          .filter(Boolean);
        if (!applicable.length) continue;
        const property = applicable.length === 1 ? applicable[0] : this.bestExtensionProperty(applicable, receiver);
        return property ? { property } : { property: null, ambiguous: applicable };
      }
      return null;
    }
    /** `new T { Name = value }` where `T` has no member `Name`: an extension property of the object being initialized. */
    memberTarget(receiver, type, item) {
      const name = item.left.identifier.valueText,
        own = lookupMembers(type, name, this.core, { within: this.c.containingType, throughType: type }).members,
        found = own.length ? null : this.applicableExtensionProperty(name, receiver);
      if (!found?.property) return super.memberTarget(receiver, type, item);
      return this.node('PropertyAccess', item.left, found.property.type, { property: found.property, receiver, isInitializerTarget: true });
    }
    /** The property as it applies to `receiver` (constructed for a generic block), or null when it does not apply. */
    extensionPropertyFor(property, receiver) {
      const getter = property.getMethod;
      if (!getter) return null;
      const result = this.d.overloads.resolve([getter], [{ ...receiver, name: null, refKind: null }], { name: property.name });
      if (!result.succeeded) return null;
      const method = result.method,
        receiverType = method.parameters[0].type;
      if (!isValidReceiverConversion(this.conversions, receiver, receiverType)) return null;
      if (method === getter) return property;
      const setter = property.setMethod ? property.setMethod.construct(method.typeArguments) : null;
      return constructedProperty(property, method, setter, receiverType);
    }
    /** The better of several applicable properties by the rules of overload resolution on the receiver, or null (ambiguous). */
    bestExtensionProperty(applicable, receiver) {
      const getters = applicable.map(property => (property.originalDefinition ?? property).getMethod),
        result = this.d.overloads.resolve(getters, [{ ...receiver, name: null, refKind: null }], {});
      if (!result.succeeded) return null;
      const chosen = result.method.originalDefinition ?? result.method;
      return applicable[getters.indexOf(chosen)] ?? null;
    }
    /** `Type.Name` where `Type` has no member `Name`: the static extension members whose block extends `Type`. */
    staticExtensionMember(left, type, name, syntax, typeArguments, options) {
      for (const scope of this.extensionMemberScopes(name, 'static')) {
        const members = scope.map(entry => this.staticExtensionFor(entry.symbol, type)).filter(Boolean);
        if (!members.length) continue;
        if (options.nameofOperand) {
          this.report(syntax, DiagnosticId.CS9316);
          return this.bad(syntax);
        }
        return this.memberResult(members, syntax, left, type, name, typeArguments, options);
      }
      // An instance extension property reached through the type: Roslyn names the type (CS0120).
      const value = { kind: 'Parameter', syntax: left.syntax, type };
      for (const scope of this.extensionMemberScopes(name, 'instance')) {
        const property = scope
          .filter(entry => entry.symbol.kind === SymbolKind.Property)
          .map(entry => this.extensionPropertyFor(entry.symbol, value))
          .find(Boolean);
        if (!property) continue;
        this.report(left.syntax, DiagnosticId.CS0120, [property.toDisplayString()]);
        return this.bad(syntax);
      }
      return null;
    }
    /** Extension operators apply when the operand types declare no applicable operator and no predefined one applies. */
    resolveBinaryOperator(operator, left, right) {
      const result = super.resolveBinaryOperator(operator, left, right);
      if (result.kind !== 'error' || result.suppressed) return result;
      return this.extensionOperator(binaryOperatorNames[operator], [left, right]) ?? result;
    }
    resolveUnaryOperator(operator, operand) {
      const result = super.resolveUnaryOperator(operator, operand);
      if (result.kind !== 'error' || result.suppressed) return result;
      return this.extensionOperator(unaryOperatorNames[operator], [operand]) ?? result;
    }
    /** The extension operator `name` of the nearest scope that has an applicable one, in the shape of `OperatorResolver`. */
    extensionOperator(name, operands) {
      if (!name) return null;
      for (const scope of this.extensionMemberScopes(name, 'operator')) {
        const candidates = scope.map(entry => entry.symbol).filter(method => method.parameters.length === operands.length),
          resolved = candidates.length ? this.d.overloads.resolve(candidates, operands, {}) : null;
        if (resolved?.succeeded)
          return { kind: 'user', method: resolved.method, resultType: resolved.method.returnType, isLifted: false, conversions: resolved.conversions };
        if (resolved?.error.code === DiagnosticId.CS0121)
          return { kind: 'error', code: DiagnosticId.CS9342, atOperator: true, args: resolved.ambiguous.slice(0, 2).map(method => method.toDisplayString()) };
      }
      return null;
    }
    /** A static extension member cannot read the receiver parameter of its block (CS9347). */
    identifier(syntax, options = {}) {
      const method = this.rootBinder.c.method,
        receiver = method?.extensionReceiver;
      if (receiver?.name && !method.parameters.includes(receiver) && syntax.identifier.valueText === receiver.name && !this.lookupLocal(receiver.name)) {
        this.report(syntax, DiagnosticId.CS9347, [receiver.name]);
        return this.bad(syntax);
      }
      return super.identifier(syntax, options);
    }
    /** The static member as it applies to `type` (constructed for a generic block), or null when its block extends another type. */
    staticExtensionFor(member, type) {
      const isProperty = member.kind === SymbolKind.Property,
        method = isProperty ? (member.getMethod ?? member.setMethod) : member,
        extended = method.extensionReceiverType;
      if (!extended) return null;
      if (!method.arity) {
        const conversion = this.conversions.classifyStandardImplicit(type, extended);
        const fits = conversion.exists && (conversion.kind === ConversionKind.Identity || conversion.kind === ConversionKind.ImplicitReference);
        return fits ? member : null;
      }
      const parameters = [...method.typeParameters],
        map = new Map();
      if (!unify(extended, type, parameters, map) || map.size !== parameters.length) return null;
      const args = parameters.map(parameter => map.get(parameter));
      if (!isProperty) return method.construct(args);
      return constructedProperty(member, member.getMethod?.construct(args) ?? null, member.setMethod?.construct(args) ?? null, null);
    }
  };
