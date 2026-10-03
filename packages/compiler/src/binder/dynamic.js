/**
 * `dynamic` (C# 4, SF-A02-T55): operations on a value of type `dynamic` are bound late. Here they get the static part
 * of Roslyn's rules: the result is `dynamic`, nothing about the member, the overload or the operator is checked, and
 * the arguments obey the restrictions of a dynamically dispatched operation.
 *
 * The nodes hold only what was written (`receiver` - a value or a method group - and `args`): what is called is not known here.
 *
 *   d.Name, d.Name<T>(...)   DynamicMemberAccess / DynamicInvocation     d[i], list[d]     DynamicElementAccess
 *   d(...), M(d), o.M(d)     DynamicInvocation                           new C(d)          DynamicObjectCreation
 *   d + x, -d, d++, d += x   Binary / Unary / Increment / CompoundAssignment of type `dynamic`
 *
 * A call whose receiver is not dynamic but that has a dynamic argument (`M(d)`) is checked statically first: when no
 * candidate could apply the usual error is reported; an ambiguity is not an error, because the overload is chosen at
 * run time from the actual type of the argument.
 *
 *   CS1973  an extension method cannot be dispatched dynamically     CS1976  a method group as an argument
 *   CS1977  a lambda as an argument                                  CS1978  an argument of type void, a pointer, ...
 *   CS8364  an `in` argument    CS8197  `out var x`    CS8183  `out _`    CS0307  `d.Name<T>` that is not invoked
 *   CS1962  typeof(dynamic)     CS1981  `is dynamic` (warning)            CS8386  new dynamic()
 *
 * Nothing here runs: the runtime has no late binder (see `dynamicOperation` in codegen/semantic/unsupported.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeKind, RefKind, DynamicTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isRefLike } from './ref-struct.js';

const dynamicType = DynamicTypeSymbol.instance;

/** True for the type `dynamic`. */
export const isDynamic = type => type?.typeKind === TypeKind.Dynamic;

const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};
const hasDynamicArgument = args => args.some(a => !a.hasErrors && isDynamic(a.type));
const argumentList = args => args.map(a => ({ expression: a, refKind: a.refKind ?? null, name: a.name ?? null }));

/** Class mixin: the operations that are bound at run time because an operand, receiver or argument is `dynamic`. */
export const DynamicBinding = Base =>
  class extends Base {
    /**
     * Binds statically what a dynamic argument makes late bound. Returns `{ node, isLateBound }`: `isLateBound` when
     * the static attempt found nothing wrong, found only an ambiguity (the overload is chosen at run time), or failed
     * on a framework member the closed registry may not list. Other diagnostics are reported as usual.
     */
    lateBound(bind) {
      const outer = this.quiet,
        flags = [this.incomplete, this.d.incomplete];
      this.quiet = [];
      let node, captured;
      try {
        node = bind();
      } finally {
        captured = this.quiet;
        this.quiet = outer;
      }
      const errors = captured.filter(d => this.d.isError(d.code)),
        isRegistryGap = node.kind === 'Bad' && !errors.length && this.incomplete && !flags[0];
      if (isRegistryGap) [this.incomplete, this.d.incomplete] = flags;
      const isLateBound = isRegistryGap || errors.every(d => d.code === DiagnosticId.CS0121);
      for (const d of captured) if (!isLateBound || !this.d.isError(d.code)) this.report(d.node, d.code, d.args);
      return { node, isLateBound };
    }
    /** The restrictions on the arguments of a dynamically dispatched operation; false when one was reported. */
    checkDynamicArguments(args) {
      let isValid = true;
      const fail = (node, code, messageArguments = []) => {
        this.report(node, code, messageArguments);
        isValid = false;
      };
      for (const a of args) {
        if (a.hasErrors) {
          isValid = false;
          continue;
        }
        const node = a.argumentSyntax?.expression ?? a.syntax;
        if (a.refKind === RefKind.In) fail(node, DiagnosticId.CS8364);
        else if (a.kind === 'DeclarationExpression' && !a.type) fail(node.designation ?? node, DiagnosticId.CS8197, [a.local?.name ?? '']);
        else if (a.kind === 'Discard') fail(node, DiagnosticId.CS8183);
        else if (a.form === 'lambda') fail(node, DiagnosticId.CS1977);
        else if (a.kind === 'MethodGroup') fail(node, DiagnosticId.CS1976);
        else if (a.literal === 'default') fail(node, DiagnosticId.CS8716);
        else if (a.type && (a.type.specialType === 'System_Void' || a.type.typeKind === TypeKind.Pointer || isRefLike(a.type)))
          fail(node, DiagnosticId.CS1978, [this.display(a.type)]);
      }
      return isValid;
    }
    dynamicNode(kind, syntax, properties, type = dynamicType) {
      return this.node(kind, syntax, type, { ...properties, isDynamic: true });
    }

    // ---- members, calls and element access ----
    instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options) {
      if (!isDynamic(type)) return super.instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options);
      if (typeArguments && !options.invoked) {
        this.report(nameSyntax, DiagnosticId.CS0307, [name, 'property']);
        return this.bad(syntax);
      }
      return this.dynamicNode('DynamicMemberAccess', syntax, { receiver: left, name, typeArguments: typeArguments ?? null });
    }
    invokeBound(target, args, syntax) {
      if (target.hasErrors) return super.invokeBound(target, args, syntax);
      if (target.kind === 'MethodGroup') {
        if (!hasDynamicArgument(args)) return super.invokeBound(target, args, syntax);
        return this.dynamicGroupCall(target, args, syntax);
      }
      const isValue = target.kind !== 'TypeExpression' && target.kind !== 'NamespaceExpression';
      if (isValue && isDynamic(target.type)) {
        if (!this.checkDynamicArguments(args)) return this.bad(syntax, { args: argumentList(args) });
        return this.dynamicNode('DynamicInvocation', syntax, { receiver: this.asValue(target), args: argumentList(args) });
      }
      if (!isValue || !hasDynamicArgument(args)) return super.invokeBound(target, args, syntax);
      // A delegate invoked with a dynamic argument.
      const { node, isLateBound } = this.lateBound(() => super.invokeBound(target, args, syntax));
      if (!isLateBound || node.hasErrors || !this.checkDynamicArguments(args)) return node;
      return this.dynamicNode('DynamicInvocation', syntax, { receiver: this.asValue(target), args: argumentList(args) });
    }
    /** `M(d)`, `o.M(d)`, `Type.M(d)`: the candidates are known, the choice between them is made at run time. */
    dynamicGroupCall(group, args, syntax) {
      // A local function is always bound statically: its result keeps its declared type.
      if (group.methods.length && group.methods.every(m => m.methodKind === MethodKind.LocalFunction)) return super.invokeBound(group, args, syntax);
      const { node, isLateBound } = this.lateBound(() => super.invokeBound(group, args, syntax));
      if (!isLateBound) return node;
      // An extension method is found through the static type of its receiver, which a late-bound call does not have.
      const isExtension = node.isExtension || (node.kind === 'Bad' && !group.methods.length && this.extensionScopesOf(group).length);
      if (isExtension && group.receiver && !group.viaType) {
        this.report(syntax, DiagnosticId.CS1973, [this.display(group.receiver.type), group.name]);
        return this.bad(syntax, { args: argumentList(args) });
      }
      if (node.kind === 'Bad' && group.methods.length && group.methods.every(isSource)) {
        const r = this.d.overloads.resolve(group.methods, args, { typeArguments: group.typeArguments, name: group.name });
        if (!r.succeeded && r.error.code !== DiagnosticId.CS0121) return node;
      }
      if (group.receiver?.kind === 'Base') {
        this.report(syntax, DiagnosticId.CS1971, [group.name]);
        return this.bad(syntax, { args: argumentList(args) });
      }
      if (!this.checkDynamicArguments(args)) return this.bad(syntax, { args: argumentList(args) });
      for (const method of group.methods) if (!this.quiet) this.d.noteUse?.(method, this.c.uri, syntax);
      return this.dynamicNode('DynamicInvocation', syntax, { receiver: group, args: argumentList(args) });
    }
    invokeConditional(target, args, syntax) {
      const isLate = isDynamic(target.type) || (target.kind === 'MethodGroup' && hasDynamicArgument(args));
      return isLate ? this.invokeBound(target, args, syntax) : super.invokeConditional(target, args, syntax);
    }
    bestCommonType(values) {
      // `dynamic` wins over every type that converts to `object`: `new[] { d, 1 }` is a `dynamic[]`.
      if (values.some(value => isDynamic(value.type)) && values.every(value => !value.type || value.type.typeKind !== TypeKind.Pointer)) return dynamicType;
      return super.bestCommonType(values);
    }
    elementAccessOn(target, args, syntax) {
      const isUsable = !target.hasErrors && !args.some(a => a.hasErrors);
      if (isUsable && isDynamic(target.type)) {
        if (!this.checkDynamicArguments(args)) return this.bad(syntax);
        return this.dynamicNode('DynamicElementAccess', syntax, { receiver: target, args: argumentList(args) });
      }
      // An array element is selected statically (a dynamic index converts to `int`); an indexer is chosen at run time.
      if (!isUsable || !hasDynamicArgument(args) || !target.type || target.type instanceof ArrayTypeSymbol)
        return super.elementAccessOn(target, args, syntax);
      const { node, isLateBound } = this.lateBound(() => super.elementAccessOn(target, args, syntax));
      if (!isLateBound || !this.checkDynamicArguments(args)) return node;
      return this.dynamicNode('DynamicElementAccess', syntax, { receiver: target, args: argumentList(args) });
    }
    create(type, args, syntax, typeNode, initializer) {
      if (isDynamic(type)) {
        this.report(typeNode, DiagnosticId.CS8386);
        return this.bad(syntax);
      }
      if (!hasDynamicArgument(args) || type.typeKind === TypeKind.Delegate) return super.create(type, args, syntax, typeNode, initializer);
      const { node, isLateBound } = this.lateBound(() => super.create(type, args, syntax, typeNode, initializer));
      // Only an ambiguity leaves the constructor to the runtime binder; the type of the expression is the class either way.
      if (!isLateBound || node.kind !== 'Bad' || !this.checkDynamicArguments(args)) return node;
      return this.dynamicNode('DynamicObjectCreation', syntax, { args: argumentList(args) }, type);
    }

    // ---- operators ----
    resolveUnaryOperator(operator, operand) {
      if (!isDynamic(operand.type)) return super.resolveUnaryOperator(operator, operand);
      return { kind: 'predefined', resultType: dynamicType, leftType: dynamicType, isDynamic: true };
    }
    resolveBinaryOperator(operator, left, right) {
      if (!isDynamic(left.type) && !isDynamic(right.type)) return super.resolveBinaryOperator(operator, left, right);
      // The operands keep their types: the runtime binder sees the static type of the one that is not dynamic.
      return { kind: 'predefined', resultType: dynamicType, leftType: left.type, rightType: right.type, family: 'dynamic', isDynamic: true };
    }

    // ---- the type itself ----
    typeTest(syntax, operand, type) {
      if (isDynamic(type)) this.report(syntax, DiagnosticId.CS1981, ['is', 'dynamic', 'Object']);
      return super.typeTest(syntax, operand, type);
    }
    expression(syntax, options = {}) {
      const node = super.expression(syntax, options);
      if (syntax.kind === 'TypeOfExpression' && isDynamic(node.operandType)) this.report(syntax, DiagnosticId.CS1962);
      return node;
    }
  };
