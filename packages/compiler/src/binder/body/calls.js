/**
 * Arguments and invocations: overload resolution, extension methods, delegate invocation, element access
 * and `out` declarations. A call that cannot be bound keeps its arguments so flow analysis still sees `out` writes.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { covariantReturnType } from '../csharp9.js';
import { SymbolKind, TypeKind, RefKind, ErrorTypeSymbol, ArrayTypeSymbol, TypeParameterSymbol } from '../../symbols/types.js';
import { MethodKind, LocalDeclarationKind } from '../../symbols/members.js';
import { ConstantValue } from '../../constants/constant-value.js';
import { convertMethodGroup } from '../../conversions/method-group.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { resolveExtensionInvocation, extensionScopes, receiverRefKind } from '../../overload/extension-methods.js';
import { lookupMembers } from '../inheritance.js';
import { checkWritable, argumentRefKind } from '../ref-kinds.js';
import { checkConstructedMethod } from '../constraints.js';
import { isVirtualCall } from '../overrides.js';
import { isCallOmitted } from '../csharp2-misc.js';
import { receiverPassing } from '../readonly.js';
import { isAbstractBaseAccess } from '../../symbols/base-implementation.js';
import { overridesOnReceiver } from '../../overload/override-parameters.js';

const unknown = ErrorTypeSymbol.unknown;
const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};

/** Class mixin: Arguments and invocations: overload resolution, extension methods, delegate invocation, element access */
export const CallBinding = Base =>
  class extends Base {
    // ---- arguments and calls ----
    argument(a) {
      const refKind = argumentRefKind(a),
        name = a.nameColon?.name.identifier.valueText ?? null;
      let e;
      if (refKind === RefKind.Out && a.expression.kind === 'DeclarationExpression') e = this.declarationExpression(a.expression, a);
      else if (
        refKind === RefKind.Out &&
        a.expression.kind === 'IdentifierName' &&
        a.expression.identifier.valueText === '_' &&
        !this.lookupLocal('_')
      )
        e = this.node('Discard', a.expression, null, { isOutVarOrDiscard: true });
      else {
        if (refKind !== RefKind.None) this.reportReservedVarPattern(a.expression);
        e = this.expression(a.expression);
      }
      if (e.kind === 'TypeExpression' || e.kind === 'NamespaceExpression') e = this.asValue(e);
      else if (refKind === RefKind.Out) this.markWrite(e, null);
      else this.markRead(e);
      if (e.kind === 'MethodGroup' && !e.convert) e.convert = to => this.groupConversion(e, to);
      if (e.kind === 'MethodGroup') {
        e.methodGroup = { returnTypeFor: types => this.groupReturnType(e, types) };
      }
      return Object.assign(e.hasErrors ? { ...e } : e, { refKind: refKind === RefKind.None ? null : refKind, name, argumentSyntax: a });
    }
    /**
     * `M(out var (a, b))` parses as a call of something named `var`. Unless the program declares that, Roslyn
     * reports the name (CS0103) and that the syntax is reserved as an lvalue (CS8199).
     */
    reportReservedVarPattern(syntax) {
      const target = syntax.kind === 'InvocationExpression' ? syntax.expression : null;
      if (target?.kind !== 'IdentifierName' || target.identifier.valueText !== 'var' || this.lookupLocal('var')) return;
      for (let type = this.c.containingType; type; type = type.containingType) if (type.getMembers('var').length) return;
      this.report(target, DiagnosticId.CS0103, ['var']);
      this.report(syntax, DiagnosticId.CS8199);
    }
    arguments(list) {
      return (list?.arguments ?? []).map(a => this.argument(a));
    }
    groupConversion(group, to) {
      if (!delegateInvoke(to)) return null;
      let methods = group.methods;
      if (group.isExtensionOnly) methods = group.extensionScopes.flatMap(s => s.methods);
      const r = convertMethodGroup(
        {
          methods,
          hasReceiver: group.viaType ? false : group.receiver ? true : undefined,
          isStaticContext: this.c.isStatic,
          typeArguments: group.typeArguments,
          name: group.name,
        },
        to,
        this.d.overloads,
        { improvedCandidates: this.version.number >= 7.3 },
      );
      group.lastConversionError = r.error ?? null;
      if (r.method) r.method.uses = (r.method.uses ?? 0) + 1;
      return r.conversion.exists ? r.conversion : null;
    }
    groupReturnType(group, parameterTypes) {
      const r = this.d.overloads.resolve(
        group.methods,
        parameterTypes.map(type => ({ type })),
        { typeArguments: group.typeArguments },
      );
      return r.succeeded ? r.method.returnType : null;
    }
    /** Where an overload-resolution error is reported: the offending argument, or the method name. */
    errorNode(error, args, nameNode, offset = 0) {
      if (error.argument !== undefined && args[error.argument - offset]?.argumentSyntax) {
        const a = args[error.argument - offset].argumentSyntax;
        return error.code === DiagnosticId.CS1739 || error.code === DiagnosticId.CS1740 ||
          error.code === DiagnosticId.CS1744 || error.code === DiagnosticId.CS8323
          ? a.nameColon.name
          : error.code === DiagnosticId.CS1620 || error.code === DiagnosticId.CS1615
            ? a.expression
            : a.expression;
      }
      return nameNode;
    }
    invocation(syntax) {
      const target = this.expression(syntax.expression, { invoked: true });
      const args = this.arguments(syntax.argumentList);
      const result = this.invokeBound(target, args, syntax);
      if (this.d.invocations && !this.quiet) this.d.recordInvocation(this.c, syntax, target, result);
      return result;
    }
    /** Invokes an already bound target with bound arguments (binder/dynamic.js takes the late-bound calls from here). */
    invokeBound(target, args, syntax) {
      // A call that could not be bound still evaluates its arguments: `out` arguments stay assigned for flow analysis.
      const outArguments = () => args.map(a => ({ expression: a, refKind: a.refKind ?? null }));
      if (target.hasErrors) return this.bad(syntax, { args: outArguments() });
      if (target.kind === 'MethodGroup') {
        const r = this.call(target, args, syntax);
        if (r.kind === 'Bad' && !r.args) r.args = outArguments();
        return r;
      }
      const value = this.asValue(target);
      if (value.hasErrors) return value;
      const invoke = value.type ? delegateInvoke(value.type) : null;
      if (invoke && value.type.typeKind === TypeKind.Delegate) {
        const r = this.d.overloads.resolve([invoke], args, { isDelegate: true, name: this.display(value.type) });
        if (!r.succeeded) {
          if (args.some(a => a.hasErrors)) return this.bad(syntax);
          const e = r.error;
          // A wrong argument count is reported on the invoked expression (the member name of `a.b`), as Roslyn does.
          const invoked = syntax.expression?.kind === 'SimpleMemberAccessExpression' ? syntax.expression.name : syntax.expression,
            isCount = e.code === 'CS1593' || e.code === 'CS7036';
          this.report(isCount && invoked ? invoked : this.errorNode(e, args, syntax), e.code, e.args);
          return this.bad(syntax);
        }
        return this.finishCall(r, value, args, syntax, { isDelegateInvoke: true });
      }
      if (value.type?.isErrorType?.()) return this.bad(syntax);
      if (
        (value.kind === 'FieldAccess' || value.kind === 'PropertyAccess' || value.kind === 'EventAccess') &&
        !isSource(value.field ?? value.property ?? value.event)
      )
        return this.lenient(syntax);
      if (value.kind === 'FieldAccess' || value.kind === 'PropertyAccess' || value.kind === 'EventAccess') {
        this.report(syntax.expression.kind === 'SimpleMemberAccessExpression' ? syntax.expression.name : syntax.expression, DiagnosticId.CS1955, [
          (value.field ?? value.property ?? value.event).toDisplayString(),
        ]);
        return this.bad(syntax);
      }
      this.report(syntax.expression, DiagnosticId.CS0149);
      return this.bad(syntax);
    }
    /** The extension methods named like the group, innermost namespace first. */
    extensionScopesOf(group) {
      if (group.extensionScopes) return group.extensionScopes;
      const chain = this.typeScope.namespaceChain.map(l => ({
        namespace: l.namespace,
        usings: l.scope.usings ? this.d.typeBinder.usingsOf(l.scope) : null,
      }));
      return extensionScopes(chain, group.name);
    }
    call(group, args, syntax) {
      const nameNode = group.nameNode ?? group.syntax,
        anyBad = args.some(a => a.hasErrors);
      let result = null;
      if (group.methods.length) {
        // An instance method reached without a receiver from a static context is dropped before resolution only if statics remain.
        const receiverType = group.viaType ? null : (group.receiver?.type ?? this.c.containingType),
          overrides = overridesOnReceiver(group.methods, receiverType);
        result = this.d.overloads.resolve(group.methods, args, { typeArguments: group.typeArguments, name: group.name, overrides });
      }
      if ((!result || !result.succeeded) && group.receiver && !group.viaType && group.kind === 'MethodGroup') {
        const scopes = this.extensionScopesOf(group);
        if (scopes.length && !anyBad) {
          const ext = resolveExtensionInvocation(group.name, group.receiver, args, scopes, this.d.overloads, {
            typeArguments: group.typeArguments,
          });
          if (ext.succeeded) {
            const receiverArgument = Object.assign({ ...group.receiver }, { refKind: receiverRefKind([ext.method]), name: null });
            return this.finishCall(ext, null, [receiverArgument, ...args], syntax, { isExtension: true, group });
          }
          if (!result && ext.found) {
            if (ext.error && scopes.flatMap(s => s.methods).every(isSource)) {
              const offset = ext.extensionArgumentOffset ?? 1;
              if (ext.error.code === DiagnosticId.CS1503 && ext.error.argument === 0 && ext.best) {
                // The receiver does not convert to the `this` parameter of the best candidate.
                const candidate = ext.best.definition;
                const receiverType = this.display(group.receiver.type);
                const wanted = this.display(candidate.parameters[0].type);
                this.report(group.receiver.syntax, DiagnosticId.CS1929, [receiverType, group.name, candidate.toDisplayString(), wanted]);
                return this.bad(syntax);
              }
              if (ext.error.code === DiagnosticId.CS1929) {
                // Applicable by its arguments, but the receiver needs more than an identity, reference or boxing conversion.
                this.report(group.receiver.syntax, ext.error.code, ext.error.args);
                return this.bad(syntax);
              }
              this.report(
                ext.error.argument !== undefined && ext.error.argument >= offset
                  ? this.errorNode({ ...ext.error }, args, nameNode, offset)
                  : nameNode,
                ext.error.code,
                ext.error.argument !== undefined && ext.error.code === DiagnosticId.CS1503
                  ? [ext.error.args[0], ext.error.args[1], ext.error.args[2]]
                  : ext.error.args,
              );
              return this.bad(syntax);
            }
            return this.lenient(syntax);
          }
        }
        if (!result) {
          if (anyBad) return this.bad(syntax);
          if (!isSource(group.receiverType))
            return this.reportMissingFrameworkMember(group.receiverType, group.name, nameNode, syntax, DiagnosticId.CS1061);
          this.report(nameNode, DiagnosticId.CS1061, [this.display(group.receiverType), group.name]);
          return this.bad(syntax);
        }
      }
      if (!result) return this.bad(syntax);
      if (!result.succeeded) {
        if (anyBad) return this.bad(syntax);
        // The registry lists only some overloads of framework methods: a failed resolution there proves nothing.
        if (!group.methods.every(isSource)) {
          if (!this.d.registryIsComplete(group.methods[0].containingType, group.name)) return this.lenient(syntax);
        }
        const e = result.error;
        if (!this.reportLambdaBodyErrors(e, args)) this.report(this.errorNode(e, args, nameNode), e.code, e.args);
        return this.bad(syntax);
      }
      return this.finishCall(result, group.receiver, args, syntax, { group });
    }
    /**
     * A lambda argument that fits its parameter's delegate type except for errors in its own body reports those
     * errors instead of CS1503. @returns {boolean} true when the errors were reported
     */
    reportLambdaBodyErrors(error, args) {
      const argument = error.code === DiagnosticId.CS1503 && error.argument !== undefined ? args[error.argument] : null;
      if (!argument || argument.form !== 'lambda' || !argument.bodyErrors || !argument.lastConversionError?.length) return false;
      for (const found of argument.lastConversionError) this.report(found.node ?? argument.syntax, found.code, found.args);
      return true;
    }
    finishCall(result, receiver, args, syntax, { group = null, isDelegateInvoke = false, isExtension = false } = {}) {
      const method = result.method,
        nameNode = group?.nameNode ?? group?.syntax ?? syntax;
      if (method.containingType?.containingAssembly) this.d.reportUseSite(method.originalDefinition ?? method, this.c.uri, nameNode);
      if (!this.quiet) this.d.noteUse?.(method, this.c.uri, syntax);
      if (group && !isExtension && !isDelegateInvoke) {
        if (method.methodKind !== MethodKind.LocalFunction) {
          if (method.isStatic) {
            if (group.receiver && !group.viaType && group.receiver.kind !== 'This') {
              this.report(nameNode === group.nameNode ? group.syntax : nameNode, DiagnosticId.CS0176, [method.toDisplayString()]);
              return this.bad(syntax);
            }
            receiver = null;
          } else if (group.viaType) {
            this.report(group.syntax, DiagnosticId.CS0120, [method.toDisplayString()]);
            return this.bad(syntax);
          } else if (group.implicitReceiver) {
            if (this.c.isStatic || group.outer || (this.c.isFieldInitializer && !this.c.isStaticInitializer)) {
              this.report(group.syntax, this.c.isFieldInitializer && !this.c.isStatic ? DiagnosticId.CS0236 : DiagnosticId.CS0120, [method.toDisplayString()]);
              return this.bad(syntax);
            }
            receiver = this.node('This', group.syntax, this.c.containingType, { isImplicit: true });
          }
        } else {
          const definition = method.originalDefinition ?? method;
          definition.uses = (definition.uses ?? 0) + 1;
        }
        for (const v of checkConstructedMethod(method, this.core)) this.report(nameNode, v.code, v.args, v.severity);
        // `base.M()` reaches the nearest override in the base classes; only when that is abstract there is no body to run.
        if (receiver?.kind === 'Base' && isAbstractBaseAccess(method, receiver.type)) {
          // Roslyn reports it at the member access, not at the whole invocation.
          this.report(syntax.kind === 'InvocationExpression' ? syntax.expression : syntax, DiagnosticId.CS0205, [method.toDisplayString()]);
        }
      }
      if (isExtension) for (const v of checkConstructedMethod(method, this.core)) this.report(nameNode, v.code, v.args);
      // Convert each argument to its parameter type and check by-reference arguments are variables.
      const converted = args.map((a, i) => {
        const p = method.parameters[result.mapping.parameterOf[i]],
          conversion = result.conversions[i];
        if (a.refKind === RefKind.Ref || a.refKind === RefKind.Out) {
          if (a.kind === 'DeclarationExpression' || a.kind === 'Discard') {
            if (a.local && a.local.type.isErrorType()) {
              a.local.setType(result.parameterTypes[i]);
              a.type = result.parameterTypes[i];
            } else if (!a.type) a.type = result.parameterTypes[i];
          } else {
            const w = checkWritable(a, a.refKind === RefKind.Ref ? 'ref' : 'out', this.variableContext);
            if (w) this.report(a.syntax, w.code, w.args);
          }
          return { expression: a, parameter: p, refKind: a.refKind };
        }
        // A typeless target-typed argument (`new()`, a conditional or switch expression, a collection expression) gets its type
        // here, and so do a `default` literal (unconverted it would be passed as a null reference), a method group and
        // a `null` for a parameter of a nullable value type, which is a value (`default(int?)`) and not a reference.
        // A tuple literal without a type of its own (`(1, null)`, `(key, x => x)`) converts element by element.
        // (So is a `null` that reaches the parameter through a user-defined conversion operator.)
        const nullToNullable = a.literal === 'null' && (!!result.parameterTypes[i]?.isNullableValueType || !!conversion?.isUserDefined),
          typeless = a.materialize || a.literal === 'default' || a.kind === 'MethodGroup' || a.form === 'tupleLiteral' || nullToNullable,
          converts = conversion && !a.hasErrors && (a.type || typeless);
        const value = converts ? this.applyConversion(a, result.parameterTypes[i], conversion, a.syntax) : a;
        if (a.form === 'lambda' && !a.hasErrors) this.finishLambda(a, result.parameterTypes[i]);
        return { expression: value, parameter: p, refKind: a.refKind ?? null };
      });
      // C# 9: a call through a receiver whose type overrides the method covariantly has the override's return type.
      const receiverType = receiver?.kind === 'Base' ? null : (receiver?.type ?? this.c.containingType),
        type = (isDelegateInvoke || isExtension ? method.returnType : covariantReturnType(method, receiverType)) ?? this.core.void;
      const n = this.node('Call', syntax, type, {
        method,
        receiver,
        args: converted,
        expanded: result.expanded,
        mapping: result.mapping,
        defaultsFrom: result.defaultsFrom ?? null,
        isDelegateInvoke,
        isExtension,
        isVirtual:
          !isDelegateInvoke &&
          !isExtension &&
          isVirtualCall(method, { isBaseAccess: receiver?.kind === 'Base', receiverType: receiver?.type }),
        constrainedTo:
          receiver?.type instanceof TypeParameterSymbol
            ? receiver.type
            : group?.viaType && group.receiverType instanceof TypeParameterSymbol
              ? group.receiverType
              : null,
      });
      // A call to a [Conditional] method whose symbols are not defined in this file is not executed.
      if (isCallOmitted(method, this.d.definedSymbols(this.c.uri))) n.isOmitted = true;
      if (receiver && receiver.type?.isValueType === true && !method.isStatic) {
        const passing = receiverPassing(receiver, method, this.variableContext);
        n.receiverPassing = passing.mode;
        if (passing.warning) this.report(nameNode, passing.warning.code, passing.warning.args);
      }
      if (type.isErrorType?.()) n.hasErrors = true;
      return n;
    }
    declarationExpression(syntax, argument) {
      const designation = syntax.designation,
        bound = this.bindType(syntax.type, { allowVar: true }),
        type = bound.isVar ? unknown : bound.type;
      if (designation.kind === 'DiscardDesignation')
        return this.node('Discard', syntax, bound.isVar ? null : type, { isOutVarOrDiscard: true });
      if (designation.kind !== 'SingleVariableDesignation') return this.lenient(syntax);
      const name = designation.identifier.valueText,
        local = this.newLocal(name, type, designation.identifier, LocalDeclarationKind.Out);
      local.writes++;
      local.isOutVar = true;
      // The nullable analysis checks what the callee stores against the declared type (`out string s`); `var` takes any state.
      local.declaredAnnotation = bound.isVar ? null : bound.nullableAnnotation;
      this.declare(name, local, designation.identifier);
      return this.node('DeclarationExpression', syntax, bound.isVar ? null : type, { local, isOutVarOrDiscard: true });
    }
    elementAccess(syntax) {
      return this.elementAccessOn(this.value(syntax.expression), this.arguments(syntax.argumentList), syntax);
    }
    /** `target[args]` over an already bound target (an index initializer supplies the object being initialized). */
    elementAccessOn(target, args, syntax) {
      if (target.hasErrors || args.some(a => a.hasErrors)) return this.bad(syntax);
      const type = target.type;
      if (!type) {
        this.report(syntax, DiagnosticId.CS0021, [target.literal === 'null' ? '<null>' : 'method group']);
        return this.bad(syntax);
      }
      if (type instanceof ArrayTypeSymbol) {
        if (args.length !== type.rank) {
          this.report(syntax, DiagnosticId.CS0022, [type.rank]);
          return this.bad(syntax);
        }
        const indices = args.map(a => {
          for (const t of [this.core.int, this.core.uint, this.core.long, this.core.ulong]) {
            const c = this.conversions.classifyFromExpression(a, t);
            if (c.exists && c.isImplicit) return this.applyConversion(a, t, c);
          }
          if (a.type && ['Index', 'Range'].includes(a.type.name)) return a;
          return this.convert(a, this.core.int);
        });
        if (indices.some(i => i.hasErrors)) return this.bad(syntax);
        if (indices.some(i => i.type?.name === 'Range')) return this.node('ArrayAccess', syntax, type, { array: target, indices });
        return this.node('ArrayAccess', syntax, type.elementType, { array: target, indices });
      }
      if (type.specialType === 'System_String' && args.length === 1) {
        const c = this.conversions.classifyFromExpression(args[0], this.core.int);
        if (c.exists && c.isImplicit) {
          const n = this.node('IndexerAccess', syntax, this.core.char, {
            receiver: target,
            property: { name: 'Chars', setMethod: null, getMethod: {}, toDisplayString: () => 'string.this[int]', refKind: RefKind.None },
            args: [{ expression: this.applyConversion(args[0], this.core.int, c) }],
          });
          return n;
        }
      }
      const indexersOf = owner =>
        lookupMembers(owner, 'this[]', this.core, { within: this.c.containingType })
          .members.concat(isSource(owner) ? [] : lookupMembers(owner, 'Item', this.core, { within: this.c.containingType }).members)
          .filter(m => m.kind === SymbolKind.Property && m.parameters.length);
      let indexers = indexersOf(type);
      // An override is not a candidate (C# spec 12.6.4.2): the indexer it overrides is, declared by a base class.
      if (indexers.some(m => m.isOverride)) {
        indexers = indexers.filter(m => !m.isOverride);
        for (let base = type.baseType; base && !indexers.length; base = base.baseType) indexers = indexersOf(base).filter(m => !m.isOverride);
      }
      // Indexers overload on their parameter lists: every indexer of the declaring type is a candidate (SF-A02-T10.2).
      if (indexers.length === 1 && isSource(type)) {
        const declared = (indexers[0].containingType ?? type).getMembers('this[]').filter(m => m.kind === SymbolKind.Property && m.parameters.length);
        if (declared.length > 1) indexers = declared;
      }
      if (!indexers.length) {
        // `object` has no indexer; any other framework type may have one the registry does not list.
        const isObject = type.specialType === 'System_Object';
        if (!isObject && !isSource(type) && type.typeKind !== TypeKind.TypeParameter && !this.d.registryIsComplete(type, 'this[]'))
          return this.lenient(syntax);
        this.report(syntax, DiagnosticId.CS0021, [this.display(type)]);
        return this.bad(syntax);
      }
      // Candidates are the accessors seen with the indexer's own parameter list (no `value`, defaults included).
      const byAccessor = new Map(),
        shapes = indexers.map(p => {
          const shape = Object.create(p.getMethod ?? p.setMethod);
          Object.defineProperty(shape, 'parameters', { value: p.parameters });
          byAccessor.set(shape, p);
          return shape;
        });
      const r = this.d.overloads.resolve(shapes, args, { name: 'this', overrides: overridesOnReceiver(shapes, type) });
      if (!r.succeeded) {
        if (!indexers.every(isSource)) return this.lenient(syntax);
        const e = r.error;
        this.report(
          this.errorNode(e, args, syntax),
          e.code === DiagnosticId.CS1501 ? DiagnosticId.CS1501 : e.code,
          e.code === DiagnosticId.CS1501 ? ['this', args.length] : e.args,
        );
        return this.bad(syntax);
      }
      const property = byAccessor.get(r.candidate.definition) ?? byAccessor.get(r.method) ?? indexers[0];
      if (isSource(property) && this.reportIfInaccessible(property, type, syntax)) return this.bad(syntax);
      return this.node('IndexerAccess', syntax, property.type, {
        receiver: target,
        property,
        args: args.map((a, i) => ({
          expression: r.conversions[i] && (a.type || a.kind === 'MethodGroup' || (a.literal === 'null' && r.parameterTypes[i]?.isNullableValueType))
            ? this.applyConversion(a, r.parameterTypes[i], r.conversions[i])
            : a,
          parameter: property.parameters[r.mapping.parameterOf[i]],
        })),
        mapping: r.mapping,
        defaultsFrom: r.defaultsFrom ?? null,
        expanded: r.expanded,
      });
    }
  };
