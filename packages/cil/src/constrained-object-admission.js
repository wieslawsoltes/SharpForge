import {CilOpcodes} from './opcodes/catalog.js';
import {CilError} from './binary.js';
import {ConstrainedReferenceObjectProfile} from './constrained-reference-object-profile.js';
import {genericTypeParts, normalizeCallType} from './generic-signatures.js';
import {verifyGenericType} from './generic-profile.js';
import {nullableMethodDefinition} from './nullable-profile.js';
import {arrayRuntimeDefinition} from './array-runtime-profile.js';

const scalarFields = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint',
  'long', 'ulong', 'float', 'double', 'nint', 'nuint', 'System.Decimal']);

function references(profile) {
  return profile.references ??= new ConstrainedReferenceObjectProfile(profile.inspector, profile.objects, profile.dispatch);
}

/** Dynamic Object fields and unconstrained parameters can select any admitted internal override. */
export function reachableObjectTargets(profile, descriptor, reachable) {
  profile.objectTargets ??= new Map();
  let targets = profile.objectTargets.get(descriptor.name);
  if (!targets) {
    const selected = new Set(references(profile).targets(0, descriptor));
    for (const type of profile.types.values()) {
      references(profile).charge(type.methods.length + 1);
      const plan = profile.objects.slot(type.token, descriptor.name);
      if (plan?.target) selected.add(plan.target);
      for (const initializer of plan?.initializers ?? []) selected.add(initializer);
    }
    targets = Object.freeze([...selected]);
    profile.objectTargets.set(descriptor.name, targets);
  }
  for (const target of targets) reachable.push(target);
}

function fieldCalls(profile, type, descriptor, reachable) {
  if (descriptor.name === 'ToString') return;
  // Scalars use their builtin value contracts. All other field categories may invoke
  // a managed Object override after a generic substitution or reference dereference.
  if (type.fields.some(field => !(field.flags & 0x10) &&
      !scalarFields.has(normalizeCallType(profile.inspector.signature(field.token).type)))) {
    reachableObjectTargets(profile, descriptor, reachable);
  }
}

/** Undefined leaves non-Object constrained calls to the existing interface/class verifier. */
export function admitConstrainedObject(profile, input, reachable) {
  const {prefix, descriptor, method, context} = input;
  if (!profile.objects.declaration(descriptor)) return undefined;
  const name = profile.inspector.metadata.typeName(prefix.operand);
  const parameter = prefix.operand >>> 24 === 27 && /^!!?\d+$/.test(name);
  if (prefix.operand >>> 24 === 27) verifyGenericType(profile.inspector, name, context);
  if (profile.objects.primitive(prefix.operand, descriptor) ||
      prefix.operand >>> 24 === 27 && profile.objects.primitive(name, descriptor)) return null;
  if (normalizeCallType(name) === 'object') {
    reachableObjectTargets(profile, descriptor, reachable);
    return null;
  }
  if (normalizeCallType(name) === 'string') return null;
  if (parameter) {
    const bound = references(profile).genericBound(method, prefix.operand);
    if (bound) {
      for (const target of references(profile).targets(bound, descriptor)) reachable.push(target);
    } else reachableObjectTargets(profile, descriptor, reachable);
    return null;
  }
  let parts = genericTypeParts(name);
  const nullable = parts.definition === 'System.Nullable`1' && parts.arguments.length === 1;
  if (nullable) {
    const element = normalizeCallType(parts.arguments[0]);
    if (scalarFields.has(element)) return null;
    if (/^!!?\d+$/.test(element)) {
      reachableObjectTargets(profile, descriptor, reachable);
      return null;
    }
    parts = genericTypeParts(element);
  }
  const type = profile.objects.names.get(parts.definition);
  if (!type || type.flags & 0x20 || profile.genericOwners.has(type.token) && !parts.arguments.length) {
    return 'constrained. Object execution requires a closed managed primitive, class or user struct';
  }
  const base = type.baseToken ? profile.inspector.metadata.typeName(type.baseToken) : null;
  if (nullable && base === 'System.Enum') return null;
  if (nullable && base !== 'System.ValueType') return 'constrained. Nullable Object calls require a non-nullable value argument';
  const plan = profile.objects.select(type.token, descriptor);
  if (plan) {
    if (plan.target) reachable.push(plan.target);
    else fieldCalls(profile, type, descriptor, reachable);
    reachable.push(...plan.initializers);
    return null;
  }
  if (references(profile).select(type.token, descriptor)) {
    for (const target of references(profile).targets(type.token, descriptor)) reachable.push(target);
    return null;
  }
  return 'constrained. Object execution requires a supported value layout or internal reference hierarchy';
}

function hasConstrainedPrefix(instructions, index) {
  for (let count = 0, at = index - 1; at >= 0 && count < 64; at--, count++) {
    const name = instructions[at].name;
    if (CilOpcodes[name]?.opCodeType !== 'Prefix') break;
    if (name === 'constrained.') return true;
  }
  return false;
}

/** Ordinary Object Equals/GetHashCode calls need the same reachable-body proof as constrained calls. */
export function verifyObjectCalls(profile, method, context, issue, reachable) {
  for (let index = 0; index < method.instructions.length; index++) {
    const instruction = method.instructions[index];
    if (!['call', 'callvirt'].includes(instruction.name) || hasConstrainedPrefix(method.instructions, index)) continue;
    try {
      const descriptor = profile.inspector.resolveToken(instruction.operand);
      if (arrayRuntimeDefinition(descriptor)?.operation === 'indexOf') {
        reachableObjectTargets(profile, {name: 'Equals'}, reachable);
      } else if (nullableMethodDefinition(descriptor)?.operation === 'text') {
        reachableObjectTargets(profile, {name: 'ToString'}, reachable);
      } else if (profile.objects.declaration(descriptor)) {
        reachableObjectTargets(profile, descriptor, reachable);
      }
    } catch (error) {
      if (!(error instanceof CilError)) throw error;
      issue(method, instruction, 'IL_TOKEN', error.message);
    }
  }
}
