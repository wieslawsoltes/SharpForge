import { CilError } from '../binary.js';
import { userStringEntry, validateUserStringMarker } from '../metadata/user-strings.js';
import { dataflowCancellation, dataflowFailure, dataflowLimit } from './dataflow.js';

function literalPreparation(context) {
  const { options, inspector } = context;
  const limit = dataflowLimit(options.maxStringLiterals, 65535, 65535);
  let remaining = dataflowLimit(options.maxStringLiteralBytes, 1048576, 1048576);
  const checked = new Set();
  const check = () => dataflowCancellation(options.signal);
  return token => {
    check();
    if (checked.has(token)) return;
    if (checked.size >= limit) dataflowFailure('String literal count limit exceeded');
    const entry = userStringEntry(inspector.metadata.streams.get('#US'), token);
    if (entry.encodedBytes > remaining) dataflowFailure('String literal byte-work limit exceeded');
    remaining -= entry.encodedBytes;
    validateUserStringMarker(entry.bytes, check);
    checked.add(token);
  };
}

/** Validate once per token during preparation; no literal text or heap view reaches transfer/block state. */
export function prepareStringLiteral(instruction, state, context) {
  state.profile ??= 'SharpForge.TypedCIL.Literals/1';
  const prepare = context.stringLiteral ??= literalPreparation(context);
  try { prepare(instruction.operand); }
  catch (error) {
    if (!(error instanceof CilError) || error.code) throw error;
    state.fail('StringOperand', error.message);
  }
}
