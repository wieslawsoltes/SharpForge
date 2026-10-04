import { Binary, FORMAT_VERSION, Op, deserializeImage, serializeImage, verifyImage } from '@sharpforge/bytecode';
import { binaryAdmission, binaryJsonBudget, binaryLimits, binaryRejection } from './binary-guards.js';
import { executePureBytecode, pureBytecodeProfile } from './binary-bytecode-profile.js';

function seed(name, code) {
  const image = {
    formatVersion: FORMAT_VERSION,
    name: 'FuzzScalar',
    entryPoint: 0,
    constants: [40, 2],
    types: [],
    statics: [],
    sequencePoints: [],
    sources: [],
    methods: [{
      id: 0, name: 'Main', qualifiedName: 'Main', owner: null, isStatic: true,
      returnType: 'int', parameters: [], handlers: [], locals: [], code: Int32Array.from(code),
    }],
  };
  return { name, input: new TextEncoder().encode(serializeImage(image)) };
}

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
  createSeeds() {
    return [
      seed('return-constant', [Op.CONST, 0, 0, Op.RET, 0, 0]),
      seed('add-two-integers', [Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0]),
    ];
  },
  run(input, context) {
    const limits = binaryLimits(input, context);
    const admission = binaryAdmission(input, limits);
    if (admission) return admission;
    const { image, failure } = decode(input, limits);
    if (failure) return failure;
    const diagnostics = verifyImage(image);
    if (diagnostics.length) return binaryRejection('BYTECODE_VALIDATION', diagnostics[0]);
    if (!pureBytecodeProfile(image)) {
      return { status: 'unsupported', code: 'BYTECODE_EXECUTION_PROFILE', detail: 'Verified; scalar-only execution profile excluded this image' };
    }
    return executePureBytecode(image, limits);
  },
});
