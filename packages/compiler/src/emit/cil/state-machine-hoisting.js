/**
 * Hoisting (SF-A02-T30): after `MoveNext` is emitted with ordinary local slots, the slots whose value must survive a
 * suspension become fields of the state machine, and their instructions are rewritten:
 *
 *   ldloc s    ->  ldarg.0; ldfld f
 *   ldloca s   ->  ldarg.0; ldflda f
 *   stloc s    ->  stloc s; ldarg.0; ldloc s; stfld f      (the slot stays, as the scratch of its own stores)
 *
 * A slot is hoisted when a resume point lies between its first and its last use in the stream, or when it is used
 * anywhere inside a loop that contains a resume point (a value written late in one round can be read early in the
 * next). That is a superset of the slots that are live across a suspension - Roslyn's debug builds hoist every local -
 * and it needs no flow analysis: O(instructions + loops * log loops).
 */

const slotUses = new Set(['ldloc', 'ldloca', 'stloc']);

const isLabel = operand => !!operand && typeof operand === 'object' && 'marked' in operand;

function branchTargetsOf(instruction) {
  const operand = instruction.operand;
  if (Array.isArray(operand)) return operand.filter(isLabel);
  return isLabel(operand) ? [operand] : [];
}

/**
 * The stretches of the stream a backward jump can repeat, merged where they overlap. A `leave` runs the finally
 * handlers of the regions it leaves before it arrives, so its stretch reaches to the end of those handlers.
 */
function loops(instructions, positions, regions) {
  const stretches = [];
  instructions.forEach((instruction, index) => {
    for (const target of branchTargetsOf(instruction)) {
      const start = positions.get(target);
      if (start === undefined || start > index) continue;
      let end = index;
      if (instruction.name === 'leave') {
        for (const region of regions) {
          const inside = positions.get(region.tryStart) <= index && index < positions.get(region.handlerEnd);
          if (inside) end = Math.max(end, positions.get(region.handlerEnd));
        }
      }
      stretches.push([start, end]);
    }
  });
  stretches.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const stretch of stretches) {
    const last = merged.at(-1);
    if (last && stretch[0] <= last[1]) last[1] = Math.max(last[1], stretch[1]);
    else merged.push([...stretch]);
  }
  return merged;
}

/**
 * The slots that must be fields.
 * @param il the IlBuilder of a `MoveNext`  @param {Set<object>} resumeLabels the labels execution resumes at
 * @returns {Set<number>} slot indexes
 */
export function slotsAcrossSuspensions(il, resumeLabels) {
  const instructions = il.instructions,
    positions = new Map(),
    resumes = [],
    first = new Map(),
    last = new Map();
  instructions.forEach((instruction, index) => {
    if (instruction.label) {
      positions.set(instruction.label, index);
      if (resumeLabels.has(instruction.label)) resumes.push(index);
    } else if (slotUses.has(instruction.name)) {
      if (!first.has(instruction.operand)) first.set(instruction.operand, index);
      last.set(instruction.operand, index);
    }
  });
  const hoisted = new Set();
  for (const [slot, start] of first) {
    const end = last.get(slot);
    if (resumes.some(resume => start < resume && resume < end)) hoisted.add(slot);
  }
  const repeated = loops(instructions, positions, il.regions).filter(([start, end]) => resumes.some(resume => start <= resume && resume <= end));
  for (const [start, end] of repeated) {
    for (let index = start; index <= end; index++) {
      const instruction = instructions[index];
      if (!instruction.label && slotUses.has(instruction.name)) hoisted.add(instruction.operand);
    }
  }
  return hoisted;
}

/**
 * Rewrites the uses of hoisted slots in place.
 * @param il the IlBuilder  @param {Map<number, number>} fieldTokens slot -> the token of the field that replaces it
 */
export function rewriteHoistedSlots(il, fieldTokens) {
  if (!fieldTokens.size) return;
  const self = { name: 'ldarg', operand: 0 };
  il.instructions = il.instructions.flatMap(instruction => {
    const token = instruction.label || !slotUses.has(instruction.name) ? undefined : fieldTokens.get(instruction.operand);
    if (token === undefined) return [instruction];
    if (instruction.name === 'ldloc') return [self, { name: 'ldfld', operand: token }];
    if (instruction.name === 'ldloca') return [self, { name: 'ldflda', operand: token }];
    return [instruction, self, { name: 'ldloc', operand: instruction.operand }, { name: 'stfld', operand: token }];
  });
  // A rewritten store holds the machine and the value above whatever was on the stack.
  il.maxDepth += 1;
}
