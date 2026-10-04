import { ilLabel } from '../inspector.js';

const comparisons = Object.freeze({ beq: '==', bne: '!=', bge: '>=', bgt: '>', ble: '<=', blt: '<' });

function branch(context, instruction) {
  const { name, operand } = instruction;
  if (name.includes('.un')) throw new Error('Unsigned/unordered branch needs typed data-flow reconstruction');
  let condition;
  if (/^br(\.s)?$/.test(name)) condition = null;
  else if (/^br(true|false)/.test(name)) {
    const value = context.truth(context.pop());
    condition = name.startsWith('brtrue') ? value : `!(${value})`;
  } else {
    const right = context.pop();
    const left = context.pop();
    const operator = comparisons[name.split('.')[0]];
    if (!operator) throw new Error(`Branch ${name} requires exception-region reconstruction`);
    condition = `${left.text} ${operator} ${right.text}`;
  }
  if (context.stack.length) throw new Error('Non-empty branch stack requires SSA reconstruction');
  context.emit(condition ? `if (${condition}) goto ${ilLabel(operand)};` : `goto ${ilLabel(operand)};`);
  if (!condition) context.reachable = false;
}

function switching(context, instruction) {
  const value = context.pop();
  if (context.stack.length) throw new Error('Switch stack merge is not reconstructable');
  context.emit(`switch (${value.text}) {`);
  instruction.operand.forEach((offset, index) => context.emit(`    case ${index}: goto ${ilLabel(offset)};`));
  context.emit('}');
}

function returning(context) {
  const type = context.method.signature.returnType;
  context.emit(type === 'void' ? 'return;' : `return ${context.coerce(context.pop(), type)};`);
  if (context.stack.length) throw new Error('Unexpected return stack');
  context.reachable = false;
}

function throwing(context) {
  context.emit(`throw ${context.pop().text};`);
  context.reachable = false;
}

export function controlInstructionHandler(opcode) {
  if (opcode.operand === 'br8' || opcode.operand === 'br32') return branch;
  return controlHandlers[opcode.name];
}

const controlHandlers = Object.freeze({ ret: returning, throw: throwing, switch: switching });
