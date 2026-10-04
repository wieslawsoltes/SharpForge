import {CilOpcodes} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {cilHandlers} from './handlers/index.js';
import {executionCodeState} from './code-version.js';
import {methodOffsets, methodOffsetAllocations} from './method-offsets.js';
import {specializeNumericHandlers} from './numeric-specialization.js';

function invalid(message) {
  throw new ManagedFault('InvalidProgramException', message);
}

function branchIndex(offsets, offset) {
  const target = offsets.get(offset);
  if (target === undefined) invalid('Decoded branch target is not an instruction boundary');
  return target;
}

function createPlan(vm, method, state) {
  const started = performance.now();
  const instructions = method.instructions;
  const count = instructions.length;
  const opcodeIds = new Int32Array(count);
  const operands = new Int32Array(count).fill(-1);
  const branchTargets = new Int32Array(count).fill(-1);
  const operandValues = [];
  const switchTargets = Array(count).fill(null);
  const allocations = methodOffsetAllocations(method);
  const offsets = methodOffsets(method);
  const handlers = Array(count);
  for (let index = 0; index < count; index++) {
    const instruction = instructions[index];
    const opcode = CilOpcodes[instruction.name];
    const handler = cilHandlers.get(instruction.name);
    if (!opcode || !handler) invalid(`Opcode '${instruction.name}' is not executable`);
    opcodeIds[index] = opcode.value;
    handlers[index] = handler;
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
  // Nonempty native typed arrays cannot be frozen. Only private canonical buffers
  // are retained; diagnostic/optimizer readers receive independent numeric copies.
  // Execution reads the frozen handler array, without invoking these accessors.
  const plan = {
    instructions: Object.freeze([...instructions]), offsets, handlers,
    operandValues: Object.freeze(operandValues),
    get opcodeIds() { return opcodeIds.slice(); },
    get operands() { return operands.slice(); },
    get branchTargets() { return branchTargets.slice(); },
    get switchTargets() { return Object.freeze(switchTargets.map(targets => targets?.slice() ?? null)); }
  };
  specializeNumericHandlers(vm, method, plan);
  Object.freeze(handlers);
  Object.freeze(plan);
  state.statistics.decodePlans++;
  state.statistics.decodedInstructions += count;
  state.statistics.offsetMapAllocations += methodOffsetAllocations(method) - allocations;
  state.statistics.decodeMilliseconds += performance.now() - started;
  return plan;
}

/** Decode once per VM code generation and closed method instance. Warm calls allocate no offset maps. */
export function getDecodePlan(vm, method) {
  const state = executionCodeState(vm);
  const cache = state.decode ??= {methods: new Map(), lastMethod: null, lastEntry: null};
  const specialized = vm.options.specializeNumericHandlers !== false;
  const typed = vm.options.typedNumericStack === true;
  const smallLong = vm.options.smallLongFastPath === true;
  if (cache.lastMethod === method && cache.lastEntry.instructions === method.instructions &&
      cache.lastEntry.specialized === specialized && cache.lastEntry.typed === typed &&
      cache.lastEntry.smallLong === smallLong) return cache.lastEntry.plan;
  let methods = cache.methods.get(method.token);
  if (!methods) cache.methods.set(method.token, methods = new WeakMap());
  let entry = methods.get(method);
  if (!entry || entry.instructions !== method.instructions || entry.specialized !== specialized || entry.typed !== typed ||
      entry.smallLong !== smallLong) {
    entry = {instructions: method.instructions, specialized, typed, smallLong, plan: createPlan(vm, method, state)};
    methods.set(method, entry);
  }
  cache.lastMethod = method;
  cache.lastEntry = entry;
  return entry.plan;
}
