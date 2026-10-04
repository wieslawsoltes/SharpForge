import { CilError } from '../binary.js';

export const controlFlowGraphDiagnosticCatalog = Object.freeze({
  CILCFG0001: 'Invalid control-flow graph input or options',
  CILCFG0002: 'Control-flow graph size limit exceeded',
  CILCFG0003: 'Control-flow graph analysis cancelled',
  CILCFG0004: 'Invalid method instructions',
  CILCFG0005: 'Control-flow target is not an instruction-group boundary inside the method',
  CILCFG0006: 'Control flow falls beyond the method body',
});

const defaults = Object.freeze({
  maxCodeBytes: 16 * 1024 * 1024,
  maxInstructions: 1_000_000,
  maxEdges: 4_000_000,
  maxClauses: 100_000,
  maxRegionDepth: 1024,
});

export function controlFlowFailure(code, detail, offset) {
  const message = controlFlowGraphDiagnosticCatalog[code];
  const error = new CilError(detail ? `${message}: ${detail}` : message, offset);
  error.code = code;
  throw error;
}

export function controlFlowCancellation(signal) {
  if (signal?.aborted) controlFlowFailure('CILCFG0003');
}

export function controlFlowOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) controlFlowFailure('CILCFG0001');
  const limits = { signal: options.signal };
  if (limits.signal != null && (typeof limits.signal !== 'object' || typeof limits.signal.aborted !== 'boolean')) {
    controlFlowFailure('CILCFG0001', 'signal');
  }
  for (const [key, ceiling] of Object.entries(defaults)) {
    const value = options[key] === undefined ? ceiling : options[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) controlFlowFailure('CILCFG0001', key);
    limits[key] = value;
  }
  controlFlowCancellation(limits.signal);
  return limits;
}

export function controlFlowExtents(codeSize, handlers, limits) {
  if (!Number.isSafeInteger(codeSize) || codeSize < 0 || !Array.isArray(handlers)) controlFlowFailure('CILCFG0001');
  if (codeSize > limits.maxCodeBytes || handlers.length > limits.maxClauses) controlFlowFailure('CILCFG0002');
  controlFlowCancellation(limits.signal);
}

export function isControlFlowInterruption(error) {
  return ['CILCFG0001', 'CILCFG0002', 'CILCFG0003', 'CILR0002', 'CILR0003', 'CILR0028'].includes(error.code);
}
