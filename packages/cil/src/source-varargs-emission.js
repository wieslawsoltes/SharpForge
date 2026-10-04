import {
  Op
} from '@sharpforge/bytecode';
import {
  CilError
} from './binary.js';

function emitVariableCall(w, c, {
  a,
  b,
  input,
  adapt
}) {
  const method = c.image.methods[a];
  if (method.callingConvention !== 5) return false;
  const receiver = method.isStatic ? 0 : 1,
    fixed = method.parameters.length + receiver;
  const types = input.slice(input.length - b),
    optional = types.slice(fixed).map(type => type === 'null' ? 'object' : type);
  if (types.length < fixed) throw new CilError('Missing fixed variable-call arguments');
  const parameters = [...method.parameters.map(parameter => parameter.type), ...optional];
  const receiverType = method.owner + (c.image.types.some(type => type.name === method.owner && type.valueType) ? '&' : '');
  adapt(types, [...(receiver ? [receiverType] : []), ...parameters]);
  const options = {
    callingConvention: 5
  };
  if (optional.length) options.sentinel = method.parameters.length;
  const signature = c.signatures.method(method.returnType, parameters, method.isStatic, options);
  const definition = c.methodTokens.get(a),
    name = c.descriptors.find(descriptor => descriptor.token === definition)?.name ?? method.name;
  const target = optional.length ? c.metadata.member(definition, name, signature) : definition;
  w.op('call', target);
  if (method.returnType === 'void') w.op('ldnull');
  return true;
}

export function emitSourceVarargsInstruction(w, c, instruction) {
  const {
    op,
    a
  } = instruction;
  if (op === Op.CALL) return emitVariableCall(w, c, instruction);
  if (op === Op.ARGLIST) w.op('arglist');
  else if (op === Op.MKREFANY || op === Op.REFANYVAL)
    w.op(op === Op.MKREFANY ? 'mkrefany' : 'refanyval', c.resolveType(c.image.constants[a]));
  else if (op === Op.REFANYTYPE) {
    w.op('refanytype').op('call', c.external('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
  } else return false;
  return true;
}

/** ArgIterator instance methods consume a managed struct address and use nonvirtual calls. */
export function emitSourceVarargsBuiltin(context, writer, builtin, types, adapt) {
  const descriptor = builtin.varargs;
  if (!descriptor) return false;
  const constructor = descriptor.name === '.ctor';
  adapt(types, [...(!descriptor.isStatic && !constructor ? [descriptor.owner + '&'] : []), ...descriptor.parameters]);
  writer.op(constructor ? 'newobj' : 'call',
    context.external(descriptor.owner, descriptor.name, descriptor.returnType, descriptor.parameters, descriptor.isStatic));
  if (descriptor.returnType === 'void' && !constructor) writer.op('ldnull');
  return true;
}
