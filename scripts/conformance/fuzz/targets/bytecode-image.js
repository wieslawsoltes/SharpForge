import { deserializeImage, verifyImage } from '@sharpforge/bytecode';
import { binaryAdmission, binaryJsonBudget, binaryLimits, binaryRejection } from './binary-guards.js';
import { boundedBytecodeProfile, executeBoundedBytecode, excludedBytecodeProfile } from './binary-bytecode-profile.js';
import { bytecodeSeeds } from './bytecode-seeds.js';

function decode(input, limits) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch (error) {
    if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
      return { failure: binaryRejection('BYTECODE_UTF8') };
    }
    throw error;
  }
  try {
    const budget = binaryJsonBudget(JSON.parse(source), { maxTypedBytes: limits.maxOutputBytes });
    if (budget) return { failure: budget };
    return { image: deserializeImage(source) };
  } catch (error) {
    if (error instanceof SyntaxError) return { failure: binaryRejection('BYTECODE_JSON', error.message) };
    if (error.constructor === Error && error.message === 'Unsupported SharpForge bytecode version') {
      return { failure: { status: 'unsupported', code: 'BYTECODE_FORMAT_VERSION' } };
    }
    throw error;
  }
}

/** Small self-authored wire images; the harness owns all mutations and process isolation. */
export const target = Object.freeze({
  id: 'bytecode-image',
  createSeeds: bytecodeSeeds,
  run(input, context) {
    const limits = binaryLimits(input, context);
    const admission = binaryAdmission(input, limits);
    if (admission) return admission;
    const { image, failure } = decode(input, limits);
    if (failure) return failure;
    const diagnostics = verifyImage(image);
    if (diagnostics.length) return binaryRejection('BYTECODE_VALIDATION', diagnostics[0]);
    if (!boundedBytecodeProfile(image)) return excludedBytecodeProfile();
    return executeBoundedBytecode(image, limits);
  },
});
