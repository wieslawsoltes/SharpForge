import { CilError } from '../binary.js';

export function dataflowFailure(message, cancelled = false) {
  const error = new CilError(message);
  error.code = cancelled ? 'CILDF0002' : 'CILDF0001';
  throw error;
}

export function dataflowLimit(value, fallback, ceiling) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > ceiling)
    dataflowFailure('Invalid dataflow limit');
  return limit;
}

export function dataflowCancellation(signal) {
  if (signal?.aborted) dataflowFailure('Dataflow analysis cancelled', true);
}

/** Internal bounded block solver. States belong to the caller; merge returns stored identity when unchanged.
 * Transfer returns null to stop a path. Each block is queued at most once at a time; changed joins are reprocessed.
 * The work budget charges incoming edges and transferred instructions, including repeated loop visits. */
export class DataflowWorklist {
  #graph;
  #context;
  #states;
  #queued;
  #queue;
  #length = 0;
  #remaining;

  constructor(graph, context, options = {}) {
    this.#graph = graph;
    this.#context = context;
    this.#remaining = dataflowLimit(options.maxDataflowSteps, 16000000, 16000000);
    this.signal = options.signal;
    dataflowCancellation(this.signal);
    this.#states = new Array(graph.blocks.length);
    this.#queued = new Uint8Array(graph.blocks.length);
    this.#queue = new Uint32Array(graph.blocks.length);
  }

  #charge(amount) {
    dataflowCancellation(this.signal);
    if (amount > this.#remaining) dataflowFailure('Dataflow convergence budget exceeded');
    this.#remaining -= amount;
  }

  enqueue(index, incoming) {
    this.#charge(1);
    if (!Number.isInteger(index) || index < 0 || index >= this.#states.length) {
      this.#context.invalidEdge();
      return;
    }
    const stored = this.#states[index];
    const state = stored === undefined ? incoming : this.#context.merge(incoming, stored, this.#graph.blocks[index]);
    if (state === undefined) dataflowFailure('Dataflow state must be defined');
    if (stored !== undefined && state === stored) return;
    this.#states[index] = state;
    if (this.#queued[index]) return;
    this.#queued[index] = 1;
    this.#queue[this.#length++] = index;
  }

  run() {
    const { blocks } = this.#graph;
    const context = this.#context;
    while (this.#length && !context.stopped()) {
      const index = this.#queue[--this.#length];
      this.#queued[index] = 0;
      const block = blocks[index];
      this.#charge(block.end - block.start);
      const output = context.transfer(block, this.#states[index]);
      if (output === null) continue;
      const outgoing = block.clearStack ? context.emptyState : output;
      for (const target of block.successors) this.enqueue(target, outgoing);
    }
    dataflowCancellation(this.signal);
    return this.#states;
  }
}
