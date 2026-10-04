import {StackCategory} from './numeric-stack-types.js';
import {acceptsNumericSlot, readNumericSlot, writeNumericSlot, shrinkNumericStack} from './numeric-block-storage.js';

function slotArray(context, operation) {
  return operation.argument ? context.arguments : context.locals;
}

function validOperation(frame, context, operation) {
  const {stack} = context;
  if (stack.length !== operation.depth || operation.instruction.name !== operation.name ||
      operation.instruction.operand !== operation.operand) return false;
  for (let index = 0; index < operation.depth; index++) {
    if (!acceptsNumericSlot(stack, index, operation.inputs[index])) return false;
  }
  if (operation.kind === 'load' || operation.kind === 'store') {
    const declared = operation.argument ? frame.method.signature.parameters[operation.parameter] : frame.method.locals[operation.index];
    const slots = slotArray(context, operation);
    if (declared !== operation.declared || operation.index >= slots.length) return false;
    if (operation.kind === 'load' && !acceptsNumericSlot(slots, operation.index, operation.category)) return false;
  }
  const pushes = operation.kind === 'load' || operation.kind === 'constant' || operation.kind === 'dup';
  return !pushes || operation.depth < stack.capacity;
}

function calculate(context, operation) {
  const {stack} = context, depth = operation.depth;
  if (operation.kind === 'constant') return operation.value;
  if (operation.kind === 'load') return readNumericSlot(slotArray(context, operation), operation.index, operation.category);
  if (operation.kind === 'store' || operation.kind === 'dup') return readNumericSlot(stack, depth - 1, operation.category);
  if (operation.kind === 'unary' || operation.kind === 'convert') {
    return operation.calculate(readNumericSlot(stack, depth - 1, operation.inputs[depth - 1]));
  }
  if (operation.calculate) return operation.calculate(
    readNumericSlot(stack, depth - 2, operation.inputs[depth - 2]), readNumericSlot(stack, depth - 1, operation.inputs[depth - 1]));
  return null;
}

function apply(vm, frame, context, operation, value) {
  const {stack} = context, depth = operation.depth;
  switch (operation.kind) {
    case 'load': case 'constant': case 'dup':
      writeNumericSlot(stack, depth, operation.category, value);
      break;
    case 'store':
      writeNumericSlot(slotArray(context, operation), operation.index, operation.category, value);
      shrinkNumericStack(stack, depth - 1);
      vm.writeRevision++;
      break;
    case 'pop': shrinkNumericStack(stack, depth - 1); break;
    case 'binary': case 'compare':
      shrinkNumericStack(stack, depth - 1);
      writeNumericSlot(stack, depth - 2, operation.kind === 'compare' ? StackCategory.i4 : operation.category,
        operation.kind === 'compare' ? Number(value) : value);
      break;
    case 'unary': case 'convert': writeNumericSlot(stack, depth - 1, operation.category, value); break;
    case 'branch':
      shrinkNumericStack(stack, depth - 2);
      if (value) frame.pc = operation.target;
      break;
    case 'jump': frame.pc = operation.target; break;
  }
}

/** Execute at most the admitted budget, committing each original PC before any arithmetic fault. */
export function executeNumericOperations(vm, frame, operations, context, budget) {
  let work = 0;
  while (work < budget) {
    const operation = operations[frame.pc];
    if (!operation || !validOperation(frame, context, operation)) break;
    let value;
    try { value = calculate(context, operation); }
    catch (error) {
      frame.lastOffset = operation.instruction.offset;
      frame.pc++;
      vm.instructions++;
      const consumed = operation.kind === 'binary' || operation.kind === 'compare' || operation.kind === 'branch' ? 2 : 1;
      shrinkNumericStack(context.stack, operation.depth - consumed);
      throw error;
    }
    // Unsafe Int64 intermediate results keep untouched original operands for ordinary BigInt fallback.
    if (value === undefined) break;
    frame.lastOffset = operation.instruction.offset;
    frame.pc++;
    vm.instructions++;
    work++;
    apply(vm, frame, context, operation, value);
    if (operation.kind === 'branch' || operation.kind === 'jump') break;
  }
  return work;
}
