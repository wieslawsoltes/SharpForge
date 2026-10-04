/** Required .NET runtime binder contracts for direct CIL dynamic operations (SF-A02-T55). */
import { SymbolKind } from '../../symbols/types.js';
import { DiagnosticId } from '../../diagnostics/codes.js';
import { UnsupportedInCil } from './unsupported.js';

const BINDER = 'Microsoft.CSharp.RuntimeBinder.Binder';
const ARGUMENT_INFO = 'Microsoft.CSharp.RuntimeBinder.CSharpArgumentInfo';
const CALL_SITE = 'System.Runtime.CompilerServices.CallSite';

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
    this.argumentFactory = this.method(this.argumentInfo, 'Create', 2);
    this.callSite = this.type(CALL_SITE, 'Create');
    this.genericCallSite = this.type(CALL_SITE + '`1', 'Create');
    this.siteFactory = this.method(this.genericCallSite, 'Create', 1);
    this.target = this.genericCallSite.getMembers('Target').find(member => member.kind === SymbolKind.Field && !member.isStatic);
    if (!this.target) throw new MissingDynamicRuntimeMember(CALL_SITE + '`1', 'Target', context);
  }
  type(name, memberName) {
    if (this.types.has(name)) return this.types.get(name);
    const type = this.manager?.getTypeByMetadataName(name);
    if (!type || type.isErrorType?.()) throw new MissingDynamicRuntimeMember(name, memberName, this.context);
    this.types.set(name, type);
    return type;
  }
  method(type, name, parameterCount) {
    const method = type.getMembers(name).find(candidate =>
      candidate.kind === SymbolKind.Method && candidate.isStatic && candidate.parameters.length === parameterCount);
    if (!method) throw new MissingDynamicRuntimeMember(type.metadataFullName, name, this.context);
    return method;
  }
  factory(operation) {
    if (this.factories.has(operation)) return this.factories.get(operation);
    const count = operation === 'InvokeMember' ? 5
      : ['GetMember', 'SetMember', 'BinaryOperation', 'UnaryOperation'].includes(operation) ? 4 : 3;
    const method = this.method(this.type(BINDER, operation), operation, count);
    this.factories.set(operation, method);
    return method;
  }
}
