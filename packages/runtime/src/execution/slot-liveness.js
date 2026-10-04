import {slotFlow} from './slot-flow.js';

export const slotLivenessLimits = Object.freeze({instructions: 65536, slots: 4096, words: 1024 * 1024, edges: 1024 * 1024,
  operations: 16 * 1024 * 1024});

function initialize(flow, words) {
  const predecessors = flow.rows.map(() => []), pinned = new Uint32Array(words);
  for (const slot of flow.implicitArguments) pinned[slot >>> 5] |= 1 << (slot & 31);
  for (let index = 0; index < flow.rows.length; index++) {
    const current = flow.rows[index];
    for (const next of current.next) predecessors[next].push(index);
    if (current.address >= 0) pinned[current.address >>> 5] |= 1 << (current.address & 31);
  }
  return {predecessors, pinned};
}

/** Bounded backward may-liveness; unsupported or expensive methods retain every slot. */
export function slotLiveness(method) {
  const flow = slotFlow(method, slotLivenessLimits);
  if (!flow) return null;
  const words = Math.ceil(flow.slots / 32), count = flow.rows.length;
  const live = new Uint32Array(count * words), output = new Uint32Array(words);
  const {predecessors, pinned} = initialize(flow, words);
  const work = Array.from({length: count}, (_, index) => index), queued = new Uint8Array(count).fill(1);
  let operations = 0;
  while (work.length) {
    const index = work.pop(), current = flow.rows[index], start = index * words;
    queued[index] = 0;
    operations += (current.next.length + 2) * words + predecessors[index].length;
    if (operations > slotLivenessLimits.operations) return null;
    output.fill(0);
    for (const next of current.next) {
      for (let word = 0; word < words; word++) output[word] |= live[next * words + word];
    }
    if (current.define >= 0) output[current.define >>> 5] &= ~(1 << (current.define & 31));
    if (current.use >= 0) output[current.use >>> 5] |= 1 << (current.use & 31);
    let changed = false;
    for (let word = 0; word < words; word++) {
      const value = (output[word] | pinned[word]) >>> 0;
      if (live[start + word] !== value) {
        live[start + word] = value;
        changed = true;
      }
    }
    if (!changed) continue;
    for (const previous of predecessors[index]) {
      if (queued[previous]) continue;
      queued[previous] = 1;
      work.push(previous);
    }
  }
  return Object.freeze({live, words, slots: flow.slots, argumentCount: flow.argumentCount, instructions: count});
}

/** Out-of-range positions and absent proofs conservatively retain the slot. */
export function liveSlot(plan, pc, index) {
  if (!plan || !Number.isSafeInteger(pc) || pc < 0 || pc >= plan.instructions ||
      !Number.isSafeInteger(index) || index < 0 || index >= plan.slots) return true;
  return !!(plan.live[pc * plan.words + (index >>> 5)] & (1 << (index & 31)));
}
