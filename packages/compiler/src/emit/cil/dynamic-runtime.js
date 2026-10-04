/** Required .NET runtime binder contracts for direct CIL dynamic operations (SF-A02-T55). */
import { SymbolKind, Accessibility, RefKind } from '../../symbols/types.js';
import { DiagnosticId } from '../../diagnostics/codes.js';
import { UnsupportedInCil } from './unsupported.js';

const BINDER = 'Microsoft.CSharp.RuntimeBinder.Binder';
const ARGUMENT_INFO = 'Microsoft.CSharp.RuntimeBinder.CSharpArgumentInfo';
const CALL_SITE = 'System.Runtime.CompilerServices.CallSite';
const CALL_SITE_BINDER = 'System.Runtime.CompilerServices.CallSiteBinder';
const FLAGS = 'Microsoft.CSharp.RuntimeBinder.CSharpBinderFlags';
const ARGUMENT_FLAGS = 'Microsoft.CSharp.RuntimeBinder.CSharpArgumentInfoFlags';
const EXPRESSION_TYPE = 'System.Linq.Expressions.ExpressionType';
const TYPE = 'System.Type';
const STRING = 'System.String';
const SEQUENCE = 'System.Collections.Generic.IEnumerable`1';
const argumentInfos = Object.freeze([SEQUENCE, ARGUMENT_INFO]);
const typeArguments = Object.freeze([SEQUENCE, TYPE]);
const factoryParameters = Object.freeze({
  BinaryOperation: [FLAGS, EXPRESSION_TYPE, TYPE, argumentInfos],
  Convert: [FLAGS, TYPE, TYPE],
  GetIndex: [FLAGS, TYPE, argumentInfos],
  GetMember: [FLAGS, STRING, TYPE, argumentInfos],
  Invoke: [FLAGS, TYPE, argumentInfos],
  InvokeConstructor: [FLAGS, TYPE, argumentInfos],
  InvokeMember: [FLAGS, STRING, typeArguments, TYPE, argumentInfos],
  IsEvent: [FLAGS, STRING, TYPE],
  SetIndex: [FLAGS, TYPE, argumentInfos],
  SetMember: [FLAGS, STRING, TYPE, argumentInfos],
  UnaryOperation: [FLAGS, EXPRESSION_TYPE, TYPE, argumentInfos],
});

/** Match the declared helper signature, including generic arguments; a same-named incompatible member is missing. */
function matches(type, expected) {
  type = type?.type ?? type;
  if (!type || type.isErrorType?.()) return false;
  if (Array.isArray(expected)) {
    const argumentsList = type.typeArguments ?? [];
    return matches(type, expected[0]) && argumentsList.length === expected.length - 1
      && argumentsList.every((argument, index) => matches(argument, expected[index + 1]));
  }
  if (typeof expected !== 'string') return type.equals(expected);
  return (type.originalDefinition ?? type).metadataFullName === expected;
}

/** Missing compiler helpers are CS0656; an incomplete reference set never produces an unloadable image. */
export class MissingDynamicRuntimeMember extends UnsupportedInCil {
  constructor(typeName, memberName, context) {
    super(`the required dynamic runtime member '${typeName}.${memberName}'`, context.syntax, context.uri);
    this.diagnosticCode = DiagnosticId.CS0656;
    this.diagnosticArguments = [typeName, memberName];
  }
}

/** Per-compilation resolution of runtime members, only instantiated when a call site is required. */
export class DynamicRuntime {
  constructor(analysis, context) {
    this.manager = analysis.references?.manager;
    this.context = context;
    this.types = new Map();
    this.factories = new Map();
    this.argumentInfo = this.type(ARGUMENT_INFO, 'Create');
    this.argumentFactory = this.method(this.argumentInfo, 'Create', [ARGUMENT_FLAGS, STRING], ARGUMENT_INFO);
    this.callSite = this.type(CALL_SITE, 'Create');
    this.genericCallSite = this.type(CALL_SITE + '`1', 'Create');
    const siteParameter = this.genericCallSite.typeParameters[0];
    this.siteFactory = this.method(this.genericCallSite, 'Create', [CALL_SITE_BINDER], [CALL_SITE + '`1', siteParameter]);
    this.target = this.genericCallSite.getMembers('Target').find(member => member.kind === SymbolKind.Field && !member.isStatic
      && member.declaredAccessibility === Accessibility.Public && matches(member.type, siteParameter));
    if (!this.target) throw new MissingDynamicRuntimeMember(CALL_SITE + '`1', 'Target', context);
  }
  type(name, memberName) {
    if (this.types.has(name)) return this.types.get(name);
    const type = this.manager?.getTypeByMetadataName(name);
    if (!type || type.isErrorType?.()) throw new MissingDynamicRuntimeMember(name, memberName, this.context);
    this.types.set(name, type);
    return type;
  }
  method(type, name, parameters, returnType) {
    const method = type.getMembers(name).find(candidate =>
      candidate.kind === SymbolKind.Method && candidate.isStatic && !candidate.typeParameters?.length
      && candidate.declaredAccessibility === Accessibility.Public && matches(candidate.returnType, returnType)
      && candidate.parameters.length === parameters.length && candidate.parameters.every((parameter, index) =>
        (!parameter.refKind || parameter.refKind === RefKind.None) && matches(parameter.type, parameters[index])));
    if (!method) throw new MissingDynamicRuntimeMember(type.metadataFullName, name, this.context);
    return method;
  }
  factory(operation) {
    if (this.factories.has(operation)) return this.factories.get(operation);
    const method = this.method(this.type(BINDER, operation), operation, factoryParameters[operation], CALL_SITE_BINDER);
    this.factories.set(operation, method);
    return method;
  }
}
