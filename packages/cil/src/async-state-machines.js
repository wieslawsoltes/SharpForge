import {CilError} from './binary.js';
import {decodeCoded} from './metadata.js';
import {genericTypeParts, instantiateSignature, normalizeCallType} from './generic-signatures.js';
import {asyncMethodDefinition, asyncTypes, asyncValueType} from './async-profile.js';
import {isAsyncFrameworkReference, verifyAsyncReferenceCall, verifyAsyncSignatureTypes} from './async-reference-identity.js';

const inventories = new WeakMap();

function inventory(inspector) {
  let value = inventories.get(inspector);
  if (!value) {
    if (inspector.types.length > 262_144 || (inspector.metadata.rows[25]?.length ?? 0) > 262_144) {
      throw new CilError('Async state-machine metadata budget exceeded');
    }
    const implementations = new Map();
    for (const row of inspector.metadata.rows[25] ?? []) {
      const owner = 0x02000000 | row[0];
      if (!implementations.has(owner)) implementations.set(owner, []);
      implementations.get(owner).push({body: decodeCoded('MethodDefOrRef', row[1]), declaration: decodeCoded('MethodDefOrRef', row[2])});
    }
    value = {types: new Map(inspector.types.map(type => [type.name, type])), implementations, machines: new Map()};
    inventories.set(inspector, value);
  }
  return value;
}

function implementation(inspector, type, arguments_, name, parameters, entries) {
  const declarations = [];
  for (const entry of entries ?? []) {
    const declaration = inspector.resolveToken(entry.declaration);
    if (declaration.owner !== asyncTypes.machine || declaration.name !== name) continue;
    verifyAsyncReferenceCall(inspector, declaration);
    const signature = declaration.signature;
    if (signature.isStatic || signature.genericArity || signature.callingConvention || signature.returnType !== 'void' ||
        signature.parameters.length !== parameters.length || signature.parameters.some((parameter, index) => parameter !== parameters[index])) {
      throw new CilError('IAsyncStateMachine MethodImpl declaration has an incompatible signature');
    }
    declarations.push(entry.body);
  }
  const candidates = declarations.length ? type.methods.filter(method => declarations.includes(method.token))
    : type.methods.filter(method => method.name === name && (method.flags & 7) === 6);
  const matches = candidates.filter(method => {
    const signature = instantiateSignature(inspector.signature(method.token), arguments_);
    return !!(method.flags & 0x40) && !(method.flags & 0x400) && !signature.isStatic && !signature.genericArity && !signature.callingConvention &&
      signature.returnType === 'void' && signature.parameters.length === parameters.length &&
      signature.parameters.every((parameter, index) => parameter === parameters[index]);
  });
  if (matches.length !== 1) throw new CilError('Async state machine requires one concrete ' + name + ' implementation');
  verifyAsyncSignatureTypes(inspector, matches[0].token);
  return matches[0].token;
}

/** Resolve the actual interface implementation, including explicit MethodImpl bodies; no naming heuristic. */
export function asyncStateMachine(inspector, input) {
  const name = normalizeCallType(input), cache = inventory(inspector);
  if (cache.machines.has(name)) return cache.machines.get(name);
  const parts = genericTypeParts(name), type = cache.types.get(parts.definition);
  if (!type || type.flags & 0x20 || cache.types.has(asyncTypes.machine) ||
      !type.interfaces.some(token => inspector.metadata.typeName(token) === asyncTypes.machine && isAsyncFrameworkReference(inspector, token))) {
    return null;
  }
  const entries = cache.implementations.get(type.token);
  const result = Object.freeze({name, token: type.token,
    valueType: !!type.baseToken && inspector.metadata.typeName(type.baseToken) === 'System.ValueType',
    moveNext: implementation(inspector, type, parts.arguments, 'MoveNext', [], entries),
    setStateMachine: implementation(inspector, type, parts.arguments, 'SetStateMachine', [asyncTypes.machine], entries)});
  cache.machines.set(name, result);
  return result;
}

/** External builder callbacks are verifier edges, not an exemption from reachability or stack admission. */
export function asyncCallbackTargets(inspector, descriptor) {
  const definition = asyncMethodDefinition(descriptor);
  if (!definition) return [];
  verifyAsyncReferenceCall(inspector, descriptor);
  if (!['start', 'await'].includes(definition.operation)) return [];
  const arguments_ = definition.methodArguments;
  const machine = asyncStateMachine(inspector, arguments_.at(-1));
  if (!machine) throw new CilError('Task builder requires an admitted IAsyncStateMachine implementation');
  if (definition.operation === 'await') {
    const awaiter = asyncValueType(arguments_[0]);
    if (!awaiter || !['awaiter', 'yieldAwaiter'].includes(awaiter.kind)) {
      throw new CilError('Custom async notification awaiters are not implemented by this CIL profile');
    }
  }
  return [machine.moveNext, machine.setStateMachine];
}

/** Permit struct arguments only after the complete builder ABI and actual callback graph are proved. */
export function isAsyncStructCall(inspector, descriptor) {
  const definition = asyncMethodDefinition(descriptor);
  if (!definition || !['start', 'await'].includes(definition.operation)) return false;
  asyncCallbackTargets(inspector, descriptor);
  return true;
}
