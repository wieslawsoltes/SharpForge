import { validateHandlerEntryHeights } from './handlers-access.js';

/** Existing execution-profile height propagation, with a separate EH entry-state check. */
export function executionStackHeights(inspector, method, offsets, context) {
  const { issue, issues, stackEffect } = context;
  let peak = 0;
  const queue = [[0, 0]];
  const heights = new Map();
  for (const handler of method.handlers) {
    if (handler.flags !== 1) queue.push([offsets.get(handler.target), handler.flags === 0 ? 1 : 0]);
  }
  while (queue.length && issues.length < 200) {
    const [index, height] = queue.pop();
    const instruction = method.instructions[index];
    if (!instruction) { issue(method, null, 'IL_FLOW', 'Control flow leaves the method'); continue; }
    peak = Math.max(peak, height);
    if (height > method.maxStack) {
      issue(method, instruction, 'IL_STACK', 'Incoming evaluation stack exceeds maxstack');
      continue;
    }
    if (heights.has(index)) {
      if (heights.get(index) !== height) issue(method, instruction, 'IL_STACK', 'Inconsistent evaluation stack height at join');
      continue;
    }
    heights.set(index, height);
    let pop, push;
    try { [pop, push] = stackEffect(inspector, method, instruction); } catch (error) {
      issue(method, instruction, 'IL_STACK', error.message);
      continue;
    }
    if (height < pop) { issue(method, instruction, 'IL_STACK', 'Evaluation stack underflow'); continue; }
    const after = height - pop + push;
    peak = Math.max(peak, after);
    if (after > method.maxStack) issue(method, instruction, 'IL_STACK', 'Evaluation stack exceeds maxstack');
    if (instruction.name === 'ret') {
      if (height !== pop) issue(method, instruction, 'IL_STACK', 'Invalid return stack');
      continue;
    }
    if (['throw', 'rethrow', 'endfinally'].includes(instruction.name)) {
      if (instruction.name === 'endfinally' && height !== 0) issue(method, instruction, 'IL_STACK', 'endfinally requires an empty stack');
      continue;
    }
    if (instruction.operandKind.startsWith('br')) {
      queue.push([offsets.get(instruction.operand), instruction.name.startsWith('leave') ? 0 : after]);
    }
    if (instruction.name === 'switch') {
      for (const target of instruction.operand) queue.push([offsets.get(target), after]);
    }
    if (!/^(br|leave)(\.s)?$/.test(instruction.name)) queue.push([index + 1, after]);
  }
  validateHandlerEntryHeights(method, offsets, heights, issue);
  return { peak, heights };
}
