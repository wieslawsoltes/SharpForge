import { identifier, typeName } from './expressions.js';

function call(context, instruction) {
  const descriptor = context.inspector.resolveToken(instruction.operand);
  const constructing = instruction.name === 'newobj';
  if (/[^A-Za-z0-9_.+]/.test(descriptor.owner)) throw new Error('Compiler-generated owner name requires IL fallback');
  if (descriptor.genericArguments || descriptor.name === '.ctor' && !constructing) {
    throw new Error('Constructor-chain or generic call reconstruction requires IL fallback');
  }
  const argumentsText = descriptor.signature.parameters.map(() => context.pop()).reverse()
    .map((value, index) => context.coerce(value, descriptor.signature.parameters[index]));
  const receiver = constructing || descriptor.signature.isStatic ? null : context.pop();
  const owner = receiver ? `(${receiver.text})` : typeName(descriptor.owner);
  let expression = constructing ? `new ${typeName(descriptor.owner)}(${argumentsText.join(', ')})`
    : `${owner}.${identifier(descriptor.name)}(${argumentsText.join(', ')})`;
  if (receiver && descriptor.name === 'get_Length' && !argumentsText.length) expression = `(${receiver.text}).Length`;
  const result = constructing ? descriptor.owner : descriptor.signature.returnType;
  if (result === 'void') context.emit(`${expression};`);
  else {
    const name = `stack${context.temporary++}`;
    context.emit(`${typeName(result)} ${name} = ${expression};`);
    context.push(name, result);
  }
}

function field(context, instruction) {
  const descriptor = context.inspector.resolveToken(instruction.operand);
  const value = instruction.name.startsWith('st') ? context.pop() : null;
  const receiver = instruction.name.endsWith('sfld') ? typeName(descriptor.owner) : `(${context.pop().text})`;
  const text = `${receiver}.${identifier(descriptor.name)}`;
  if (value) context.emit(`${text} = ${context.coerce(value, descriptor.signature.type)};`);
  else context.capture(text, descriptor.signature.type);
}

function newArray(context, instruction) {
  const length = context.pop();
  const type = typeName(context.inspector.metadata.typeName(instruction.operand));
  context.capture(`new ${type}[${length.text}]`, `${type}[]`);
}

function loadElement(context) {
  const index = context.pop();
  const array = context.pop();
  context.capture(`(${array.text})[${index.text}]`, array.type.replace(/\[\]$/, ''));
}

function storeElement(context) {
  const value = context.pop();
  const index = context.pop();
  const array = context.pop();
  context.emit(`(${array.text})[${index.text}] = ${context.coerce(value, array.type.replace(/\[\]$/, ''))};`);
}

function convertObject(context, instruction) {
  const value = context.pop();
  const type = typeName(context.inspector.metadata.typeName(instruction.operand));
  if (instruction.name === 'box') context.capture(`(object)(${context.coerce(value, type)})`, 'object');
  else if (instruction.name === 'isinst') context.capture(`(${value.text} as ${type})`, type);
  else context.capture(`(${type})(${value.text})`, type);
}

export function memberInstructionHandler(opcode) {
  if (opcode.name === 'ldelem' || opcode.name.startsWith('ldelem.')) return loadElement;
  if (opcode.name === 'stelem' || opcode.name.startsWith('stelem.')) return storeElement;
  return memberHandlers[opcode.name];
}

const memberHandlers = Object.freeze({
  call,
  callvirt: call,
  newobj: call,
  ldfld: field,
  ldsfld: field,
  stfld: field,
  stsfld: field,
  newarr: newArray,
  ldlen: context => context.capture(`(${context.pop().text}).Length`),
  box: convertObject,
  castclass: convertObject,
  'unbox.any': convertObject,
  isinst: convertObject,
});
