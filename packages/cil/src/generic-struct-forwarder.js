import {methodGenericParameters, normalizeCallType, resolveExecutionMethod} from './call-profile.js';

function argumentIndex(instruction) {
  if (instruction.name === 'ldarg' || instruction.name === 'ldarg.s') return instruction.operand;
  return ['ldarg.0', 'ldarg.1', 'ldarg.2', 'ldarg.3'].indexOf(instruction.name);
}

/**
 * Admit only static Apply<T>(ref T, ...) forwarding to one nongeneric interface member.
 * This metadata-only, linear predicate rejects local/EH/storage operations and generic
 * declaring types. Malformed metadata throws through the inspector's usual diagnostics.
 */
export function isByrefStructForwarder(inspector, token) {
  if (token >>> 24 !== 6 || !inspector.methods.has(token)) return false;
  const method = inspector.getMethod(token), signature = method.signature;
  if (!method.hasBody || !signature.isStatic || signature.genericArity !== 1 ||
      methodGenericParameters(inspector, method.ownerToken).length || method.locals.length || method.handlers.length ||
      signature.parameters[0] !== '!!0&' || signature.returnType.includes('!') || signature.returnType.endsWith('&') ||
      signature.parameters.slice(1).some(type => type.includes('!'))) return false;
  const body = method.instructions.filter(instruction => instruction.name !== 'nop');
  const count = signature.parameters.length;
  if (body.length !== count + 3 || body[count].name !== 'constrained.' ||
      body[count + 1].name !== 'callvirt' || body[count + 2].name !== 'ret') return false;
  if (method.instructions[method.instructions.indexOf(body[count]) + 1] !== body[count + 1]) return false;
  if (body[count].operand >>> 24 !== 27 || inspector.metadata.typeName(body[count].operand) !== '!!0') return false;
  for (let index = 0; index < count; index++) if (argumentIndex(body[index]) !== index) return false;
  const declaration = resolveExecutionMethod(inspector, body[count + 1].operand);
  const owner = inspector.types.find(type => type.token === declaration.ownerToken);
  const target = declaration.signature;
  if (!owner || !(owner.flags & 0x20) || methodGenericParameters(inspector, owner.token).length ||
      target.isStatic || target.genericArity || declaration.methodArguments?.length ||
      target.parameters.length !== count - 1 || normalizeCallType(target.returnType) !== normalizeCallType(signature.returnType)) return false;
  return target.parameters.every((type, index) => normalizeCallType(type) === normalizeCallType(signature.parameters[index + 1]));
}
