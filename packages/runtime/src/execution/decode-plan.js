import {CilOpcodes} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {cilHandlers} from './handlers/index.js';
import {executionCodeState} from './code-version.js';
import {methodOffsets, methodOffsetAllocations} from './method-offsets.js';

function invalid(message) {
  throw new ManagedFault('InvalidProgramException', message);
}

function branchIndex(offsets, offset) {
  const target = offsets.get(offset);
  if (target === undefined) invalid('Decoded branch target is not an instruction boundary');
  return target;
}

function operandMetadata(instructions, offsets) {
  const count = instructions.length;
  const opcodeIds = new Int32Array(count);
  const operands = new Int32Array(count).fill(-1);
  const branchTargets = new Int32Array(count).fill(-1);
  const operandValues = [];
  const switchTargets = Array(count).fill(null);
  for (let index = 0; index < count; index++) {
    const instruction = instructions[index];
    const opcode = CilOpcodes[instruction.name];
    opcodeIds[index] = opcode.value;
    if (instruction.operand !== undefined) {
      operands[index] = operandValues.length;
      operandValues.push(Array.isArray(instruction.operand) ? Object.freeze([...instruction.operand]) : instruction.operand);
    }
    if (opcode.operand === 'switch') {
      switchTargets[index] = Int32Array.from(instruction.operand, target => branchIndex(offsets, target));
    } else if (opcode.operand === 'br8' || opcode.operand === 'br32') {
      branchTargets[index] = branchIndex(offsets, instruction.operand);
    }
  }
  return {opcodeIds, operands, branchTargets, switchTargets, operandValues: Object.freeze(operandValues)};
}

function createPlan(method, state) {
  const started = performance.now();
  const instructions = Object.freeze([...method.instructions]);
  const allocations = methodOffsetAllocations(method);
  const offsets = methodOffsets(method);
  const handlers = Array(instructions.length);
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    const opcode = CilOpcodes[instruction.name];
    const handler = cilHandlers.get(instruction.name);
    if (!opcode || !handler) invalid(`Opcode '${instruction.name}' is not executable`);
    handlers[index] = handler;
    if (opcode.operand === 'switch') {
      for (const target of instruction.operand) branchIndex(offsets, target);
    } else if (opcode.operand === 'br8' || opcode.operand === 'br32') {
      branchIndex(offsets, instruction.operand);
    }
  }
  // Dispatch only needs handlers and original instructions. Allocate optional
  // numeric diagnostics on their first read; these buffers never enter snapshots.
  let metadata;
  const readMetadata = () => metadata ??= operandMetadata(instructions, offsets);
  const plan = {
    instructions, offsets, handlers: Object.freeze(handlers),
    get operandValues() { return readMetadata().operandValues; },
    get opcodeIds() { return readMetadata().opcodeIds.slice(); },
    get operands() { return readMetadata().operands.slice(); },
    get branchTargets() { return readMetadata().branchTargets.slice(); },
    get switchTargets() { return Object.freeze(readMetadata().switchTargets.map(targets => targets?.slice() ?? null)); }
  };
  Object.freeze(plan);
  state.statistics.decodePlans++;
  state.statistics.decodedInstructions += instructions.length;
  state.statistics.offsetMapAllocations += methodOffsetAllocations(method) - allocations;
  state.statistics.decodeMilliseconds += performance.now() - started;
  return plan;
}

/** Decode once per VM code generation and method identity, sharing the existing offset-map cache. */
export function getDecodePlan(vm, method) {
  const state = executionCodeState(vm);
  const cache = state.decode ??= {methods: new Map(), lastMethod: null, lastEntry: null};
  if (cache.lastMethod === method && cache.lastEntry.instructions === method.instructions) return cache.lastEntry.plan;
  let methods = cache.methods.get(method.token);
  if (!methods) cache.methods.set(method.token, methods = new WeakMap());
  let entry = methods.get(method);
  if (!entry || entry.instructions !== method.instructions) {
    entry = {instructions: method.instructions, plan: createPlan(method, state)};
    methods.set(method, entry);
  }
  cache.lastMethod = method;
  cache.lastEntry = entry;
  return entry.plan;
}
