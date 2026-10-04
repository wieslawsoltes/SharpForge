/**
 * Function pointers (C# 9, SF-A02-T73): `delegate*<...>` types, `&Method`, invocation and `[UnmanagedCallersOnly]`.
 *
 *   type          `delegate* managed|unmanaged[Conv, ...]<parameters, return>`; an unknown calling convention is
 *                 CS8890; like every pointer type it needs an unsafe context (CS0214, reported at `delegate*`)
 *   &Method       has no type of its own (`var f = &M;` is CS0815). Converted to a function pointer type it selects
 *                 the method of the group whose parameters are the pointer's: CS8757 when none is, CS8759 for an
 *                 instance method, CS0407 for another return type, CS8786 when the calling conventions differ (an
 *                 `[UnmanagedCallersOnly]` method fits `delegate* unmanaged` only, every other method `managed` only)
 *   invocation    `p(args)`: the arguments convert to the parameter types (CS1503), their number is the pointer's
 *                 (CS8756); a pointer has no members (`p.Invoke` is CS1061)
 *   comparison    `==` and `!=` of two function pointers warn (CS8909): the address of a method is not unique
 *   UnmanagedCallersOnly   the method is static and ordinary (CS8896) and not generic (CS8895) with unmanaged parameter
 *                 and return types (CS8894) passed by value (CS8977), and is never called directly (CS8901)
 *
 * Conversions between pointer types are in conversions/pointer.js. The direct CIL emitter writes ldftn/calli;
 * the image back end reports the pointer type (SF2200) because it has no indirect-call instruction.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, RefKind, FunctionPointerTypeSymbol } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';
import { isFunctionPointerType } from '../conversions/pointer.js';
import { Conversion, ConversionKind } from '../conversions/classify.js';
import { isManagedType } from './unsafe-declarations.js';
import { checkConstructedMethod } from './constraints.js';
import { functionPointerSignatureMethod, selectFunctionPointerTarget } from './function-pointer-targets.js';
import {
  functionPointerConventionName, knownFunctionPointerConventions, unmanagedCallersOnlyAttribute, unmanagedConventionMarkers,
} from './function-pointer-conventions.js';
const comparisons = new Set(['==', '!=']);

const refKindOf = parameter => {
  const modifiers = (parameter.modifiers ?? []).map(token => token.text);
  if (modifiers.includes('out')) return RefKind.Out;
  if (modifiers.includes('ref')) return modifiers.includes('readonly') ? RefKind.RefReadOnlyParameter : RefKind.Ref;
  return modifiers.includes('in') ? RefKind.In : RefKind.None;
};

/**
 * Binds a FunctionPointerType syntax.
 * @param {(typeSyntax: object) => object} bindType binds a parameter or return type to a TypeWithAnnotations
 * @param {(node: object, code: string, args: any[]) => void} report
 */
export function bindFunctionPointerType(syntax, bindType, report) {
  const convention = syntax.callingConvention,
    names = [...(convention?.unmanagedCallingConventionList?.callingConventions ?? [])];
  for (const name of names) {
    if (!knownFunctionPointerConventions.includes(name.name.valueText)) report(name.name, DiagnosticId.CS8890, ['CallConv' + name.name.valueText]);
  }
  const parameters = [...syntax.parameterList.parameters],
    last = parameters.pop(),
    returnedRef = last.type.kind === 'RefType'
      ? last.type.readonlyKeyword ? RefKind.RefReadOnly : RefKind.Ref
      : refKindOf(last);
  return new FunctionPointerTypeSymbol({
    callingConvention: convention?.managedOrUnmanagedKeyword.text === 'unmanaged' ? 'unmanaged' : 'managed',
    unmanagedConventions: names.map(name => name.name.valueText),
    returnType: bindType(last.type.kind === 'RefType' ? last.type.type : last.type),
    returnRefKind: returnedRef === RefKind.RefReadOnlyParameter ? RefKind.RefReadOnly : returnedRef,
    parameters: parameters.map(parameter => ({ type: bindType(parameter.type), refKind: refKindOf(parameter) })),
  });
}

const isUnmanagedCallersOnly = method => !!unmanagedCallersOnlyAttribute(method);

/** Class mixin of the body binder. */
export const FunctionPointerBinding = Base =>
  class extends Base {
    /** `&Method`: the address of a method group, typed by the function pointer type it is converted to. */
    addressOf(syntax, inFixedInitializer) {
      let operandSyntax = syntax.operand;
      while (operandSyntax.kind === 'ParenthesizedExpression') operandSyntax = operandSyntax.expression;
      const saved = this.quiet;
      this.quiet = [];
      let group;
      try {
        group = this.expression(operandSyntax, { invoked: true });
      } finally {
        this.quiet = saved;
      }
      if (group.kind !== 'MethodGroup') return super.addressOf(syntax, inFixedInitializer);
      this.requireUnsafe(syntax);
      const address = this.node('AddressOfMethodGroup', syntax, null, { group, form: 'methodAddress' });
      address.convert = type => {
        if (!isFunctionPointerType(type)) return null;
        const selected = selectFunctionPointerTarget(group, type, this.d.overloads);
        return selected.method ? new Conversion(ConversionKind.MethodGroup, { method: selected.method }) : null;
      };
      address.materialize = type => this.convert(address, type);
      return address;
    }
    convert(e, type, node = e.syntax, options = {}) {
      if (e.kind === 'MethodGroup' && isFunctionPointerType(type)) {
        this.report(e.syntax, DiagnosticId.CS8787);
        return this.bad(node);
      }
      if (e.kind !== 'AddressOfMethodGroup' || !type || type.isErrorType?.()) return super.convert(e, type, node, options);
      if (!isFunctionPointerType(type)) {
        this.report(e.syntax, DiagnosticId.CS8812, [e.group.name ?? '', this.display(type)]);
        return this.bad(node);
      }
      const method = this.functionPointerTarget(e, type);
      return method ? this.functionPointerLoad(e, type, method) : this.bad(node);
    }
    applyConversion(expression, type, conversion, node = expression.syntax, isExplicit = false) {
      if (expression.kind !== 'AddressOfMethodGroup') return super.applyConversion(expression, type, conversion, node, isExplicit);
      return this.convert(expression, type, node);
    }
    functionPointerLoad(address, type, method) {
      for (const violation of checkConstructedMethod(method, this.core)) {
        this.report(address.group.syntax, violation.code, violation.args, violation.severity);
      }
      const definition = method.originalDefinition ?? method;
      definition.uses = (definition.uses ?? 0) + 1;
      return this.node('FunctionPointerLoad', address.syntax, type, {
        method,
        constrainedTo: address.group.viaType ? address.group.receiverType : null,
      });
    }
    /** The method of `&group` a function pointer type selects, or null after reporting why there is none. */
    functionPointerTarget(address, type) {
      const selected = selectFunctionPointerTarget(address.group, type, this.d.overloads);
      if (selected.error) {
        const error = selected.error;
        const name = address.group.syntax?.name ?? address.group.syntax;
        this.report(error.atName ? name : address.syntax, error.code, error.args);
      }
      return selected.method;
    }
    /** `var f = &M;` has no type to infer: CS0815 on the declarator, as for a lambda. */
    implicitLocalType(value, init, declarator) {
      if (value.kind !== 'AddressOfMethodGroup') return super.implicitLocalType(value, init, declarator);
      this.report(declarator, DiagnosticId.CS0815, ['method group']);
      return { value, type: null };
    }
    invokeBound(target, args, syntax) {
      const type = target.hasErrors || target.kind === 'MethodGroup' ? null : target.type;
      if (!isFunctionPointerType(type)) return super.invokeBound(target, args, syntax);
      const pointer = this.asValue(target);
      const parameters = type.signature.parameters;
      this.requireUnsafe(syntax);
      if (args.some(argument => argument.hasErrors)) return this.bad(syntax);
      if (args.length !== parameters.length) {
        this.report(syntax, DiagnosticId.CS8756, [this.display(type), args.length]);
        return this.bad(syntax);
      }
      const named = args.filter(argument => argument.name);
      if (named.length) {
        for (const argument of named) this.report(argument.argumentSyntax.nameColon, DiagnosticId.CS8905);
        return this.bad(syntax);
      }
      const signatures = this.functionPointerSignatures ??= new Map();
      let method = signatures.get(type);
      if (!method) signatures.set(type, method = functionPointerSignatureMethod(type));
      const result = this.d.overloads.resolve([method], args, { name: this.display(type) });
      if (!result.succeeded) {
        const error = result.error;
        this.report(this.errorNode(error, args, syntax), error.code, error.args);
        return this.bad(syntax);
      }
      // Ordinary Call nodes preserve ref/out definite assignment, nullable analysis and ref-return safety.
      return this.finishCall(result, pointer, args, syntax, { isDelegateInvoke: true });
    }
    /** A function pointer has no members. */
    instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options) {
      if (!isFunctionPointerType(type)) return super.instanceMember(left, type, name, nameSyntax, syntax, typeArguments, options);
      this.report(nameSyntax, DiagnosticId.CS1061, [this.display(type), name]);
      return this.bad(syntax);
    }
    binary(syntax, operator) {
      const result = super.binary(syntax, operator);
      const operands = [result.left, result.right],
        comparesWithNull = [syntax.left, syntax.right].some(operand => operand.kind === 'NullLiteralExpression');
      if (comparisons.has(operator) && !result.hasErrors && !comparesWithNull && operands.every(operand => isFunctionPointerType(operand?.type)))
        this.report(syntax.operatorToken, DiagnosticId.CS8909);
      return result;
    }
    /** An [UnmanagedCallersOnly] method is entered from unmanaged code only: a direct call is CS8901. */
    finishCall(result, receiver, args, syntax, options = {}) {
      const call = super.finishCall(result, receiver, args, syntax, options);
      if (result.method && !options.isDelegateInvoke && isUnmanagedCallersOnly(result.method)) this.report(syntax, DiagnosticId.CS8901, [result.method.toDisplayString()]);
      return call;
    }
  };

/**
 * The declaration rules of an `[UnmanagedCallersOnly]` method.
 * @returns {{at: object|null, code: string, args: any[]}[]} `at` null means the attribute name
 */
export function checkUnmanagedCallersOnly(method) {
  const attribute = unmanagedCallersOnlyAttribute(method);
  if (!attribute) return [];
  const rows = [];
  for (const marker of unmanagedConventionMarkers(attribute)) {
    if (!functionPointerConventionName(marker.type)) {
      rows.push({ at: attribute.syntax, code: DiagnosticId.CS8893, args: [marker.type?.toDisplayString() ?? '<null>'] });
    }
  }
  if (![MethodKind.Ordinary, MethodKind.LocalFunction].includes(method.methodKind) || !method.isStatic || method.isAbstract || method.isVirtual) {
    return [...rows, { at: null, code: DiagnosticId.CS8896, args: [] }];
  }
  if (method.typeParameters?.length || method.containingType?.isGenericType) {
    return [...rows, { at: null, code: DiagnosticId.CS8895, args: [] }];
  }
  for (const parameter of method.parameters) {
    if ((parameter.refKind ?? RefKind.None) !== RefKind.None) rows.push({ at: parameter.syntax, code: DiagnosticId.CS8977, args: [] });
    else if (isManagedType(parameter.type)) rows.push({ at: parameter.syntax, code: DiagnosticId.CS8894, args: [parameter.type.toDisplayString(), 'parameter'] });
  }
  if (!method.returnsVoid && isManagedType(method.returnType))
    rows.push({ at: method.returnTypeSyntax, code: DiagnosticId.CS8894, args: [method.returnType.toDisplayString(), 'return'] });
  return rows;
}

/** Class mixin (analysis phase): the `[UnmanagedCallersOnly]` rules, run once the attributes are bound. */
export const FunctionPointerRules = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      for (const type of this.assembly.types)
        for (const method of type.getMembers()) {
          if (method.kind !== SymbolKind.Method) continue;
          const attribute = unmanagedCallersOnlyAttribute(method);
          for (const row of checkUnmanagedCallersOnly(method))
            this.report(method.uri ?? this.at(method).uri, row.at ?? attribute.syntax.name, row.code, row.args);
        }
    }
  };
