/**
 * Simple names and member access: locals, parameters, members of enclosing types, types, namespaces,
 * using-static members, `Color Color`, and member lookup on values with extension-method fallback.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind, ErrorTypeSymbol, ArrayTypeSymbol } from '../../symbols/types.js';
import { isKnownMissingMember } from '../../symbols/predefined-member-names.js';
import { spanElementType } from '../../conversions/span.js';
import { ConstantValue } from '../../constants/constant-value.js';
import { extensionScopes, isValidReceiverConversion, couldTakeReceiver } from '../../overload/extension-methods.js';
import { findConstruction } from '../../symbols/substitution.js';
import { lookupMembers } from '../inheritance.js';
import { tupleElement, tupleElementProblem } from '../tuples.js';
import { checkConstructedType } from '../constraints.js';
import { staticMembersOfTypeParameter, staticVirtualAccess } from '../interface-members.js';
import { accessorNamed, isOperatorMethod } from '../special-methods.js';
import { staticImportsNamed } from '../csharp6.js';

const unknown = ErrorTypeSymbol.unknown;
/** A member that can be invoked: a method or event, or a field or property of a delegate type or `dynamic`. */
const isInvocable = member =>
  ![SymbolKind.Field, SymbolKind.Property].includes(member.kind) || [TypeKind.Delegate, TypeKind.Dynamic].includes(member.type?.typeKind);
const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly || s.isAnonymousType) return true;
  return false;
};

/** Class mixin: Simple names and member access: locals, parameters, members of enclosing types, types, namespaces, */
export const NameBinding = Base =>
  class extends Base {
    /** A simple name: local, parameter, member of an enclosing type, type, namespace or using-static member. */
    identifier(syntax, options = {}) {
      const name = syntax.identifier.valueText,
        typeArguments = this.typeArgumentsOf(syntax),
        arity = typeArguments?.length ?? 0;
      if (syntax.identifier.isMissing) return this.bad(syntax);
      {
        const local = this.lookupLocal(name);
        if (local && (!arity || local.kind === SymbolKind.Method)) {
          if (local.kind === SymbolKind.Local) {
            this.reportCapturedRefLike(local, syntax);
            return this.localNode(local, syntax);
          }
          if (local.kind === SymbolKind.Parameter) {
            if (this.isOuterByRefParameter(local)) this.report(syntax, DiagnosticId.CS1628, [name]);
            else this.reportCapturedRefLike(local, syntax);
            return this.node('Parameter', syntax, local.type, { parameter: local });
          }
          if (local.kind === SymbolKind.Method)
            return this.node('MethodGroup', syntax, null, { methods: [local], receiver: null, name, form: 'methodGroup', typeArguments });
        }
        if (!arity && this.isPending(name)) {
          this.report(syntax, DiagnosticId.CS0841, [name]);
          // The use still counts for the unused-variable warnings: an assignment as a write, anything else as a read.
          const isWrite = syntax.parent?.kind === 'SimpleAssignmentExpression' && syntax.parent.left === syntax;
          (this.rootBinder.usedBeforeDeclaration ??= new Map()).set(name, isWrite && !this.rootBinder.usedBeforeDeclaration.has(name));
          return this.bad(syntax);
        }
        if (!arity && name === '_' && options.allowDiscard) return this.node('Discard', syntax, null, { isOutVarOrDiscard: true });
      }
      // Members of the containing types, innermost first.
      for (let type = this.c.containingType, first = true; type; type = type.containingType, first = false) {
        const found = lookupMembers(type, name, this.core, { within: this.c.containingType });
        if (found.members.length) {
          const r = this.memberResult(found.members, syntax, null, type, name, typeArguments, options, !first);
          if (r) return r;
        } else if (found.inaccessible.length && !this.d.typeBinder.lookup(name, arity, this.typeScope)) {
          this.report(syntax, DiagnosticId.CS0122, [found.inaccessible[0].toDisplayString()]);
          return this.bad(syntax);
        }
      }
      const symbol = this.d.typeBinder.lookup(name, arity, this.typeScope);
      if (symbol && !symbol.ambiguous && !symbol.wrongArity) {
        if (symbol.kind === SymbolKind.Namespace) return this.node('NamespaceExpression', syntax, null, { namespace: symbol });
        const type = arity ? this.bindType(syntax).type : symbol;
        if (!arity && !this.quiet) this.d.noteUse?.(symbol, this.c.uri, syntax);
        return this.node('TypeExpression', syntax, null, { referencedType: type });
      }
      if (symbol?.ambiguous) {
        this.report(syntax, DiagnosticId.CS0104, [name, symbol.ambiguous[0].toDisplayString(), symbol.ambiguous[1].toDisplayString()]);
        return this.bad(syntax);
      }
      // using static members
      for (const level of this.typeScope.namespaceChain) {
        const usings = level.scope.usings ? this.d.typeBinder.usingsOf(level.scope) : null;
        if (!usings) continue;
        const { members, ambiguous } = staticImportsNamed(usings.staticTypes, name);
        if (ambiguous) {
          this.report(syntax, DiagnosticId.CS0229, ambiguous.map(member => member.toDisplayString()));
          return this.bad(syntax);
        }
        if (members.length)
          return this.memberResult(members, syntax, null, members[0].containingType, name, typeArguments, options, false) ?? this.bad(syntax);
      }
      if (!symbol && !arity) {
        const builtin = this.d.executionBuiltin?.(name);
        if (builtin) return this.node('TypeExpression', syntax, null, { referencedType: builtin });
      }
      if (name === 'nameof' && options.invoked) return this.node('NameOfMarker', syntax, null, {});
      if (name === 'var' || name === 'dynamic') return this.lenient(syntax);
      if (this.d.isKnownFrameworkName(name)) return this.lenient(syntax);
      for (let type = this.c.containingType; type; type = type.containingType)
        if (this.reportAccessorByName(type, name, syntax.identifier)) return this.bad(syntax);
      // A local of the file's top-level statements is in scope inside its types, where it cannot be used (CS8801).
      const isTopLevelName = !this.rootBinder.c.isTopLevel && this.d.topLevelNames?.(this.c.uri).has(name);
      this.report(syntax.kind === 'GenericName' ? syntax : syntax.identifier, isTopLevelName ? DiagnosticId.CS8801 : DiagnosticId.CS0103, [name]);
      return this.bad(syntax);
    }
    /** `alias::Name` in an expression: a namespace or type reached through a using alias, an extern alias or `global`. */
    aliasQualifiedName(syntax) {
      // Roslyn reports no obsolete use for a type named through `alias::` in an expression.
      const symbol = this.d.typeBinder.bindNamespaceOrType(syntax, this.typeScope, { isAliasQualifiedExpression: true });
      if (symbol.kind === SymbolKind.Namespace) return this.node('NamespaceExpression', syntax, null, { namespace: symbol });
      if (symbol.isErrorType()) return symbol.isFrameworkGap ? this.lenient(syntax) : this.bad(syntax);
      return this.node('TypeExpression', syntax, null, { referencedType: symbol });
    }
    /** CS0571 when `name` is the metadata name of an accessor of `type` (`get_X`, `add_E`); returns whether it was reported. */
    reportAccessorByName(type, name, node) {
      const membersNamed = (owner, memberName) => lookupMembers(owner, memberName, this.core, { within: this.c.containingType }).members,
        accessor = accessorNamed(type, name, membersNamed);
      if (accessor) this.report(node, DiagnosticId.CS0571, [accessor]);
      return !!accessor;
    }
    localNode(local, syntax) {
      const n = this.node('Local', syntax, local.type, { local });
      if (local.isConst && local.constantValueObject) n.constantValue = local.constantValueObject;
      if (local.type?.isErrorType?.()) n.hasErrors = true;
      return n;
    }
    /** Turns looked-up members into a bound node; `receiver` null means an implicit `this` or a static access through a simple name. */
    memberResult(members, syntax, receiver, type, name, typeArguments, options = {}, outer = false) {
      const first = members[0],
        nameNode = syntax.kind === 'SimpleMemberAccessExpression' ? syntax.name : syntax;
      if (first.kind === SymbolKind.NamedType) {
        const t = typeArguments ? this.construct(first, typeArguments, nameNode) : first;
        if (!this.quiet) this.d.noteUse?.(first, this.c.uri, nameNode);
        return this.node('TypeExpression', syntax, null, { referencedType: t });
      }
      const viaType = receiver?.kind === 'TypeExpression',
        implicit = !receiver,
        // C# 11: a static abstract or virtual interface member is reached through a type parameter only.
        virtualAccess = viaType && !options.nameofOperand ? staticVirtualAccess(first, receiver.referencedType) : null;
      if (virtualAccess?.code) this.report(syntax, virtualAccess.code);
      const instanceReceiver = () => {
        if (!implicit) return receiver;
        if (this.c.isStatic || (this.c.isFieldInitializer && !this.c.isStaticInitializer) || outer) {
          return null;
        }
        return this.node('This', syntax, this.c.containingType, { isImplicit: true });
      };
      if (first.kind === SymbolKind.Method) {
        const methods = members.filter(m => m.kind === SymbolKind.Method);
        if (methods.every(isOperatorMethod)) {
          this.report(nameNode, DiagnosticId.CS0571, [first.toDisplayString()]);
          return this.bad(syntax);
        }
        return this.node('MethodGroup', syntax, null, {
          methods,
          receiver: viaType ? null : receiver,
          receiverType: viaType ? receiver.referencedType : (receiver?.type ?? type),
          viaType,
          implicitReceiver: implicit,
          outer,
          name,
          nameNode,
          form: 'methodGroup',
          typeArguments,
          convert: null,
        });
      }
      const used = () => {
        if (first.kind === SymbolKind.Field) {
          const f = first.originalDefinition ?? first;
          f.reads = (f.reads ?? 0) + 1;
        }
      };
      if (typeArguments) {
        this.report(nameNode, DiagnosticId.CS0307, [
          first.kind === SymbolKind.Field ? 'field' : first.kind === SymbolKind.Property ? 'property' : 'event',
          name,
        ]);
        return this.bad(syntax);
      }
      if (first.containingType?.containingAssembly) this.d.reportUseSite(first, this.c.uri, nameNode);
      // Inside its class a field-like event names its backing field, which is not the obsolete symbol.
      const ownEvent = first.kind === SymbolKind.Event && first.containingType?.originalDefinition === this.c.containingType?.originalDefinition;
      if (!this.quiet && !ownEvent) this.d.noteUse?.(first, this.c.uri, syntax);
      const isStatic = first.isStatic;
      let r = null;
      if (isStatic) {
        if (receiver && !viaType && receiver.kind !== 'Base') {
          // `Color Color`: a member whose name equals its type's name may be read as the type.
          if (!(
            receiver.syntax?.kind === 'IdentifierName' &&
            receiver.type &&
            receiver.syntax.identifier.valueText === receiver.type.name
          )) {
            used();
            this.report(syntax, DiagnosticId.CS0176, [first.toDisplayString()]);
            return this.bad(syntax);
          }
        }
      } else {
        if (viaType) {
          if (receiver.syntax?.kind === 'IdentifierName' && receiver.colorColor) r = receiver.colorColor;
          else if (!options.nameofOperand) {
            used();
            this.report(syntax, DiagnosticId.CS0120, [first.toDisplayString()]);
            return this.bad(syntax);
          }
        } else {
          r = instanceReceiver();
          // `nameof` names a member without evaluating it; reaching through an instance member needs C# 12.
          if (!r && options.nameofOperand) {
            if (options.memberAccessLeft) this.d.gate(this.c.uri, syntax, 'InstanceMemberInNameof');
          } else if (!r) {
            used();
            this.report(syntax, this.c.isFieldInitializer && !this.c.isStatic && !outer ? DiagnosticId.CS0236 : DiagnosticId.CS0120, [first.toDisplayString()]);
            return this.bad(syntax);
          }
        }
      }
      switch (first.kind) {
        case SymbolKind.Field: {
          const n = this.node('FieldAccess', syntax, first.type, { field: first, receiver: r });
          if (first.isConst || first.isEnumMember) {
            const cv = this.d.constantOf(first.originalDefinition ?? first);
            if (cv) n.constantValue = cv;
            else if (first.isConst) n.hasErrors = true;
            // Inside an enum's own member initializers the other members have the underlying type (no casts needed).
            if (first.isEnumMember && this.c.enumInitializerOf === first.containingType) {
              n.type = this.core.enumUnderlying(first.containingType);
              if (cv) n.constantValue = ConstantValue.integral(cv.type, cv.bigint);
              else n.hasErrors = true;
            }
          }
          if (first.type?.isErrorType?.()) n.hasErrors = true;
          return n;
        }
        case SymbolKind.Property: {
          const n = this.node('PropertyAccess', syntax, first.type, { property: first, receiver: r });
          if (virtualAccess?.constrainedTo) n.constrainedTo = virtualAccess.constrainedTo;
          if (first.type?.isErrorType?.()) n.hasErrors = true;
          return n;
        }
        case SymbolKind.Event:
          return this.node('EventAccess', syntax, first.type, { event: first, receiver: r });
      }
      return this.lenient(syntax);
    }
    construct(definition, typeArguments, node) {
      if (definition.arity !== typeArguments.length) {
        this.report(
          node,
          definition.arity ? DiagnosticId.CS0305 : DiagnosticId.CS0308,
          definition.arity ? [definition.toDisplayString(), 'type', definition.arity] : [definition.toDisplayString(), 'type'],
        );
        return unknown;
      }
      const type = definition.construct(typeArguments);
      for (const v of checkConstructedType(type, this.core)) this.report(node, v.code, v.args);
      return type;
    }
    memberAccess(syntax, options = {}) {
      const nameSyntax = syntax.name;
      if (!nameSyntax || nameSyntax.identifier?.isMissing) return this.bad(syntax);
      const name = nameSyntax.identifier.valueText,
        typeArguments = this.typeArgumentsOf(nameSyntax);
      let left = this.requireNaturalType(this.expression(syntax.expression, { ...options, invoked: false, memberAccessLeft: true }));
      if (left.hasErrors) {
        if (left.kind === 'Local') left.local.reads++;
        // A member named after a field of the enclosing type counts as a use of that field even though the access failed.
        for (let t = this.c.containingType; t; t = t.containingType)
          for (const f of t.getMembers(name))
            if (f.kind === SymbolKind.Field) (f.originalDefinition ?? f).reads = ((f.originalDefinition ?? f).reads ?? 0) + 1;
        return this.bad(syntax, { operand: left });
      }
      // Color Color: an identifier that binds to a member whose type has the same name can also denote the type.
      if (
        syntax.expression.kind === 'IdentifierName' &&
        left.type &&
        left.kind !== 'TypeExpression' &&
        left.type.name === syntax.expression.identifier.valueText
      ) {
        const t = this.d.typeBinder.lookup(left.type.name, 0, this.typeScope);
        if (t && t === left.type.originalDefinition) {
          const statics = lookupMembers(left.type, name, this.core, { within: this.c.containingType }).members;
          if ((statics.length && statics[0].isStatic) || statics[0]?.kind === SymbolKind.NamedType)
            left = this.node('TypeExpression', syntax.expression, null, { referencedType: left.type, colorColor: left });
        }
      }
      if (left.kind === 'NamespaceExpression') {
        const ns = left.namespace,
          arity = typeArguments?.length ?? 0,
          type = ns.getTypeMembers(name, arity)[0];
        if (type)
          return this.node('TypeExpression', syntax, null, {
            referencedType: typeArguments ? this.construct(type, typeArguments, nameSyntax) : type,
          });
        const child = arity ? null : ns.getNamespace(name);
        if (child) return this.node('NamespaceExpression', syntax, null, { namespace: child });
        if (this.d.isFrameworkGap(ns.toDisplayString(), name)) return this.lenient(syntax);
        this.report(nameSyntax, DiagnosticId.CS0234, [name, ns.toDisplayString()]);
        return this.bad(syntax);
      }
      if (left.kind === 'TypeExpression') {
        const type = left.referencedType;
        if (type.isErrorType()) return this.bad(syntax);
        if (type.typeKind === TypeKind.TypeParameter) {
          const statics = staticMembersOfTypeParameter(type, name, this.core);
          if (statics.length) return this.memberResult(statics, syntax, left, type, name, typeArguments, options);
          this.report(syntax.expression, DiagnosticId.CS0119, [type.name, 'type parameter']);
          return this.bad(syntax);
        }
        const found = lookupMembers(type, name, this.core, { within: this.c.containingType });
        if (!found.members.length) {
          if (found.inaccessible.length) {
            this.report(nameSyntax, DiagnosticId.CS0122, [found.inaccessible[0].toDisplayString()]);
            return this.bad(syntax);
          }
          if (this.reportAccessorByName(type, name, nameSyntax)) return this.bad(syntax);
          const extension = this.staticExtensionMember(left, type, name, syntax, typeArguments, options);
          if (extension) return extension;
          if (!isSource(type) && type.typeKind !== TypeKind.Enum)
            return this.reportMissingFrameworkMember(type, name, nameSyntax, syntax, DiagnosticId.CS0117);
          this.report(nameSyntax, DiagnosticId.CS0117, [this.display(type), name]);
          return this.bad(syntax);
        }
        return this.memberResult(found.members, syntax, left, type, name, typeArguments, options) ?? this.bad(syntax);
      }
      left = this.asValue(left);
      if (left.hasErrors) return this.bad(syntax);
      if (left.kind === 'MethodGroup' && left.methods.length) {
        this.report(syntax.expression, DiagnosticId.CS0119, [left.methods[0].toDisplayString(), 'method']);
        return this.bad(syntax);
      }
      if (left.literal === 'default') {
        this.report(syntax.expression, DiagnosticId.CS8716);
        return this.bad(syntax);
      }
      if (left.kind === 'MethodGroup' || left.form === 'lambda' || left.literal) {
        this.report(syntax, DiagnosticId.CS0023, ['.', left.literal === 'null' ? '<null>' : left.form === 'lambda' ? 'lambda expression' : 'method group']);
        return this.bad(syntax);
      }
      const type = left.type;
      if (!type) return this.bad(syntax);
      if (type.specialType === 'System_Void') {
        this.report(syntax.operatorToken ?? syntax, DiagnosticId.CS0023, ['.', 'void']);
        return this.bad(syntax);
      }
      return this.instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options);
    }
    /** Member lookup on a value of `type`; falls back to extension methods when invoked. */
    instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options) {
      const problem = tupleElementProblem(type, name, this.display(type));
      if (problem) {
        this.report(nameSyntax, problem.code, problem.args);
        return this.bad(syntax);
      }
      const element = tupleElement(type, name);
      if (element) {
        // A named tuple element is the field at its position; a name the literal inferred needs C# 7.1 (CS8306).
        if (element.isInferred && this.version.number < 7.1) this.report(nameSyntax, DiagnosticId.CS8306, [name, '7.1']);
        name = element.field;
        // An element a long tuple holds in `Rest` is a field of the tuple type itself.
        if (element.symbol) return this.memberResult([element.symbol], syntax, left, type, name, typeArguments, options) ?? this.bad(syntax);
      }
      const lookupType = type instanceof ArrayTypeSymbol ? this.core.array : type;
      const found = lookupMembers(lookupType, name, this.core, {
        within: this.c.containingType,
        throughType: left.kind === 'Base' ? this.c.containingType : type,
      });
      // The length of a single-dimensional array is the array's own operation (`ldlen`), not a call of the
      // `System.Array.Length` property a referenced core library declares.
      const isVectorLength = type instanceof ArrayTypeSymbol && type.isSZArray && (name === 'Length' || name === 'LongLength');
      if (type instanceof ArrayTypeSymbol && (!found.members.length || isVectorLength)) {
        if (name === 'Length' || name === 'Rank') return this.node('ArrayLength', syntax, this.core.int, { array: left, member: name });
        if (name === 'LongLength') return this.node('ArrayLength', syntax, this.core.long, { array: left, member: name });
      }
      if (found.members.length) {
        // An invoked name ignores the members that cannot be invoked (C# spec 12.5): `list.Count(predicate)` is the
        // extension method although `List<T>` has a `Count` property.
        const hidden = options.invoked && !found.members.some(isInvocable),
          group = hidden ? this.extensionGroup(left, type, name, { nameSyntax, syntax, typeArguments }) : null;
        return group ?? this.memberResult(found.members, syntax, left, type, name, typeArguments, options) ?? this.bad(syntax);
      }
      if (found.inaccessible.length) {
        this.reportInaccessible(found.inaccessible[0], type, nameSyntax);
        return this.bad(syntax);
      }
      if (this.reportAccessorByName(lookupType, name, nameSyntax)) return this.bad(syntax);
      // A base type in an assembly that is not referenced: the lookup cannot be completed (CS0012) and finds nothing.
      const missingBase = this.d.missingBaseReason(lookupType);
      if (missingBase) {
        this.report(nameSyntax, missingBase.code, missingBase.args);
        this.report(nameSyntax, DiagnosticId.CS1061, [this.display(type), name]);
        return this.bad(syntax);
      }
      const extension = this.instanceExtensionMember(left, type, name, syntax, typeArguments, options);
      if (extension) return extension;
      // A predefined type whose member names are all known cannot have the member: extension methods are next.
      const isKnownGap = isKnownMissingMember(type, name) && !this.importsUnknownNamespaces();
      // On a type that is not fully known a missing member proves nothing. An array is the exception when an
      // extension method in scope takes it as its receiver: an array has no instance method that could be meant.
      // So are Span<T> and ReadOnlySpan<T>, the receivers the C# 14 span conversions are for.
      const isOpen = !isKnownGap && (type.hasUnknownConstraint || !this.d.closedHierarchy(type)),
        isSpan = !!(spanElementType(type, 'Span') ?? spanElementType(type, 'ReadOnlySpan'));
      if (isOpen && !(type instanceof ArrayTypeSymbol) && !isSpan) return this.lenient(syntax);
      // Extension methods (only meaningful when the name is invoked, but a method group conversion may also use them).
      const scopes = this.extensionScopesNamed(name),
        takesReceiver = method => method.name === name && isValidReceiverConversion(this.conversions, left, method.parameters[0].type);
      // For a span receiver any extension method of that name is a candidate: its type arguments are inferred later.
      if (isOpen && !isSpan && !scopes.some(scope => scope.methods.some(takesReceiver))) return this.lenient(syntax);
      // The name is a method group only when an extension method could take the receiver; otherwise it is unknown.
      const construction = (from, definition) => findConstruction(from, definition, this.core),
        isInvoked = !!options.invoked,
        fits = method => method.name === name && couldTakeReceiver(this.conversions, left, method.parameters[0].type, construction, { isInvoked }),
        isCandidate = isOpen || isSpan || scopes.some(scope => scope.methods.some(fits)),
        group = isCandidate ? this.extensionGroup(left, type, name, { nameSyntax, syntax, typeArguments, scopes }) : null;
      if (group) return group;
      if (!isKnownGap && !isSource(type) && type.typeKind !== TypeKind.TypeParameter)
        return this.reportMissingFrameworkMember(type, name, nameSyntax, syntax, DiagnosticId.CS1061);
      this.report(nameSyntax, DiagnosticId.CS1061, [this.display(type), name]);
      return this.bad(syntax);
    }
    /** The extension methods named `name` in scope, innermost namespace first. */
    extensionScopesNamed(name) {
      const chain = this.typeScope.namespaceChain.map(level => ({
        namespace: level.namespace,
        usings: level.scope.usings ? this.d.typeBinder.usingsOf(level.scope) : null,
      }));
      return extensionScopes(chain, name);
    }
    /** The method group of the extension methods named `name` on the receiver `left`, or null when none is in scope. */
    extensionGroup(left, type, name, { nameSyntax, syntax, typeArguments, scopes = this.extensionScopesNamed(name) }) {
      if (!scopes.length) return null;
      return this.node('MethodGroup', syntax, null, {
        methods: [],
        extensionScopes: scopes,
        receiver: left,
        receiverType: type,
        name,
        nameNode: nameSyntax,
        form: 'methodGroup',
        typeArguments,
        isExtensionOnly: true,
      });
    }
    /** Seams of binder/extension-members.js: a member the type lacks, found among the extension members in scope (or null). */
    instanceExtensionMember() {
      return null;
    }
    staticExtensionMember() {
      return null;
    }
    /** True when a using directive in scope names a namespace the registry does not model (it may bring extension methods). */
    importsUnknownNamespaces() {
      for (const level of this.typeScope.namespaceChain) {
        if (level.scope.usings) this.d.typeBinder.usingsOf(level.scope);
      }
      return this.d.hasUnknownUsings === true;
    }
    /** A member the registry does not list: reported only for the types whose member set the registry is known to cover. */
    reportMissingFrameworkMember(type, name, nameSyntax, syntax, code) {
      if (this.d.registryIsComplete(type, name)) {
        this.report(nameSyntax, code, [this.display(type), name]);
        return this.bad(syntax);
      }
      return this.lenient(syntax);
    }
  };
