import {Op} from '@sharpforge/bytecode';
import {Writer, CilError} from './binary.js';
import {signatureType} from './type-signatures.js';

/** A managed variable-argument callsite is a MemberRef parented by its fixed MethodDef. */
export function variableCallToken(context, method, input) {
  const fixed = method.parameters.length, first = method.isStatic ? 0 : 1;
  const parameters = [...method.parameters.map(parameter => parameter.type), ...input.slice(first + fixed)];
  const writer = new Writer().u8((method.isStatic ? 0 : 0x20) | 5).compressed(parameters.length);
  signatureType(writer, method.returnType, context.resolveType);
  parameters.forEach((type, index) => {
    if (index === fixed) writer.u8(0x41);
    signatureType(writer, type, context.resolveType);
  });
  return context.metadata.member(context.methodTokens.get(method.id), method.name, writer.finish());
}

export function analyzeVarargsInstruction(stack, {op, a}, image) {
  if (![Op.ARGLIST, Op.MKREFANY, Op.REFANYVAL, Op.REFANYTYPE].includes(op)) return false;
  if (op === Op.ARGLIST) { stack.push('System.RuntimeArgumentHandle'); return true; }
  const input = stack.pop();
  if (op === Op.MKREFANY) {
    if (input !== image.constants[a] + '&') throw new CilError('mkrefany requires an exact managed address type');
    stack.push('typedref');
  } else {
    if (input !== 'typedref' && input !== 'System.TypedReference') throw new CilError('Typed reference operand required');
    stack.push(op === Op.REFANYTYPE ? 'System.Type' : image.constants[a] + '&');
  }
  return true;
}

export function emitVarargsInstruction(writer, context, {op, a}) {
  if (op === Op.ARGLIST) writer.op('arglist');
  else if (op === Op.MKREFANY) writer.op('mkrefany', context.resolveType(context.image.constants[a]));
  else if (op === Op.REFANYVAL) writer.op('refanyval', context.resolveType(context.image.constants[a]));
  else if (op === Op.REFANYTYPE) {
    writer.op('refanytype').op('call', context.external('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
  } else return false;
  return true;
}

export function decodeVarargsInstruction(span, context) {
  const operation = span.find(item => ['arglist', 'mkrefany', 'refanyval', 'refanytype'].includes(item.name));
  if (!operation) return null;
  const opcode = {arglist: Op.ARGLIST, mkrefany: Op.MKREFANY, refanyval: Op.REFANYVAL, refanytype: Op.REFANYTYPE}[operation.name];
  const type = operation.operand ? context.metadata.typeName(operation.operand) : null;
  return [opcode, type ? context.intern(context.shortType(type)) : 0, 0];
}
