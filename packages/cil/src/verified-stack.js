const proofs = new WeakMap();
const instructionFields = ['offset', 'name', 'size', 'operandKind'];
const handlerFields = ['flags', 'start', 'end', 'target', 'handlerEnd', 'catchType'];

/** Record bounds only for a successful verification of this exact inspector/body generation. */
export function recordVerifiedStacks(inspector, report, methods) {
  if (report.success) proofs.set(report, {inspector, methods});
  return report;
}

function unchangedBody(method, entry) {
  if (method.instructions !== entry.instructions || method.handlers !== entry.handlers ||
      method.maxStack !== entry.maxStack || method.instructions.length !== entry.code.length ||
      method.handlers.length !== entry.regions.length) return false;
  for (let index = 0; index < entry.code.length; index++) {
    const instruction = method.instructions[index], saved = entry.code[index];
    if (!instruction || instructionFields.some((key, field) => instruction[key] !== saved[field])) return false;
    const operand = saved[instructionFields.length];
    if (Array.isArray(operand)) {
      if (!Array.isArray(instruction.operand) || instruction.operand.length !== operand.length ||
          operand.some((value, item) => instruction.operand[item] !== value)) return false;
    } else if (instruction.operand !== operand) return false;
  }
  return entry.regions.every((saved, index) =>
    method.handlers[index] && handlerFields.every((key, field) => method.handlers[index][key] === saved[field]));
}

/** Return a frozen bound or null. O(instructions + handlers), intended for cold admission.
 * Tokens and copied reports alone are not proof. Generic frames may share the canonical body.
 */
export function verifiedStackBound(inspector, report, method) {
  const proof = proofs.get(report);
  if (proof?.inspector !== inspector || !report.success) return null;
  const entry = proof.methods.get(method.token);
  if (!entry || !unchangedBody(method, entry) ||
      inspector.getMethod(method.token).instructions !== entry.instructions) return null;
  return entry.bound;
}

export function verifiedStackEntry(method, peak) {
  return Object.freeze({instructions: method.instructions, handlers: method.handlers, maxStack: method.maxStack,
    code: method.instructions.map(instruction => [...instructionFields.map(key => instruction[key]),
      Array.isArray(instruction.operand) ? [...instruction.operand] : instruction.operand]),
    regions: method.handlers.map(handler => handlerFields.map(key => handler[key])),
    bound: Object.freeze({capacity: method.maxStack, peak})});
}
