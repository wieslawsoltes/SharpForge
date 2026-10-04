import {asyncStateMachine, isAsyncStructCall} from './async-state-machines.js';
import {CilError} from './binary.js';
import {nullableMethodDefinition} from './nullable-profile.js';
import {frameworkType} from '@sharpforge/framework';
import {genericTypeParts} from './field-profile.js';
import {methodGenericParameters, normalizeCallType} from './call-profile.js';
import {parseFunctionPointerType} from './function-pointer-signature.js';
import {isByrefStructForwarder} from './generic-struct-forwarder.js';
import {isSizeOfOnlyMethod} from './generic-sizeof-method.js';

/** Symbolic context used to qualify one canonical body shared by its instantiations. */
export function genericDefinitionContext(inspector, method) {
  const parameters = methodGenericParameters(inspector, method.ownerToken);
  const methods = methodGenericParameters(inspector, method.token);
  for (const list of [parameters, methods]) {
    if (list.some((parameter, index) => parameter.index !== index)) throw new CilError('Invalid generic parameter ordinals');
  }
  if (methods.length !== (method.signature.genericArity ?? 0)) throw new CilError('Generic method arity does not match metadata');
  const typeArguments = parameters.map((_, index) => '!' + index);
  const methodArguments = methods.map((_, index) => '!!' + index);
  return {ownerToken: method.ownerToken, typeArguments, methodArguments,
    genericIdentity: typeArguments.length ? method.owner + '<' + typeArguments.join(',') + '>' : null};
}

function genericArgument(inspector, type, context, methodToken = null, layoutOnly = false) {
  if (type === 'void' || /[&*]$/.test(type)) throw new CilError('Generic arguments must be managed non-void types');
  verifyGenericType(inspector, type, context);
  const parts = genericTypeParts(type);
  const definition = inspector.types.find(candidate => candidate.name === parts.definition);
  if (!layoutOnly && definition?.baseToken && inspector.metadata.typeName(definition.baseToken) === 'System.ValueType') {
    if (parts.arguments.length || methodGenericParameters(inspector, definition.token).length ||
        !isByrefStructForwarder(inspector, methodToken)) {
      throw new CilError('Struct generic arguments require a static Apply<T>(ref T, ...) constrained interface forwarder');
    }
  }
}

/** Validate variable bounds and closed type arity without pretending to verify aggregate storage. */
export function verifyGenericType(inspector, input, context, depth = 0) {
  if (depth > 64) throw new CilError('Generic signature nesting limit exceeded');
  const type = normalizeCallType(input);
  if (type.startsWith('method ')) {
    const signature = parseFunctionPointerType(type);
    if (!signature || !signature.isStatic || signature.callingConvention || /!\d/.test(type)) {
      throw new CilError('Only closed managed static function-pointer storage is executable');
    }
    for (const item of signature.parameters.concat(signature.returnType)) verifyGenericType(inspector, item, context, depth + 1);
    return;
  }
  if (/\bpinned\b|\bmod(req|opt)\b|\*/.test(type)) throw new CilError('Native-pointer and modified signatures are inspection-only');
  const variable = /^(!!?)(\d+)$/.exec(type);
  if (variable) {
    const arguments_ = variable[1] === '!!' ? context.methodArguments : context.typeArguments;
    if (Number(variable[2]) >= arguments_.length) throw new CilError('Generic signature variable is outside its declaring context');
    return;
  }
  const suffix = type.match(/(?:\[[,]*\]|&)$/);
  if (suffix) return verifyGenericType(inspector, type.slice(0, -suffix[0].length), context, depth + 1);
  const parts = genericTypeParts(type);
  if (!parts.arguments.length) {
    if (/`\d+$/.test(parts.definition) && !frameworkType(parts.definition)) {
      throw new CilError('Open generic storage requires a complete instantiation');
    }
    return;
  }
  const definition = inspector.types.find(candidate => candidate.name === parts.definition);
  const arity = definition ? methodGenericParameters(inspector, definition.token).length : Number(/`(\d+)$/.exec(parts.definition)?.[1]);
  if (parts.arguments.length !== arity) throw new CilError('Generic type argument count mismatch');
  for (const argument of parts.arguments) {
    if (argument === 'void' || /[&*]$/.test(argument)) throw new CilError('Generic arguments must be managed non-void types');
    verifyGenericType(inspector, argument, context, depth + 1);
  }
}

export function verifyGenericCall(inspector, descriptor, context) {
  const arity = descriptor.signature.genericArity ?? 0;
  const target = descriptor.resolvedToken ?? descriptor.definitionToken ?? descriptor.token;
  const layoutOnly = isSizeOfOnlyMethod(inspector, target);
  const asyncCall = isAsyncStructCall(inspector, descriptor);
  if (descriptor.resolvedToken && methodGenericParameters(inspector, descriptor.ownerToken).length && !descriptor.ownerInstance) {
    throw new CilError('Generic declaring type requires a TypeSpec context');
  }
  const owner = inspector.types.find(type => type.token === descriptor.ownerToken);
  if (!layoutOnly && descriptor.ownerInstance && owner?.baseToken && inspector.metadata.typeName(owner.baseToken) === 'System.ValueType' &&
      !asyncStateMachine(inspector, descriptor.ownerInstance)) {
    throw new CilError('Generic aggregate owners require T03 value storage');
  }
  if (arity && !descriptor.genericArguments) throw new CilError('Generic method calls require MethodSpec arguments');
  for (const argument of descriptor.methodArguments ?? []) {
    genericArgument(inspector, argument, context, target, layoutOnly || asyncCall);
  }
  for (const argument of descriptor.typeArguments ?? []) {
    if (nullableMethodDefinition(descriptor)) verifyGenericType(inspector, argument, context);
    else genericArgument(inspector, argument, context, null, layoutOnly);
  }
  for (const type of [...descriptor.signature.parameters, descriptor.signature.returnType]) verifyGenericType(inspector, type, context);
}
