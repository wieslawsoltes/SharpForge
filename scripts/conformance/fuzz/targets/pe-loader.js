import { compileToIL } from '@sharpforge/compiler';
import { AssemblyInspector, CilError, loadAssembly, readMethodHeader, readPE, validateMetadata } from '@sharpforge/cil';
import { binaryAdmission, binaryFailure, binaryJsonBudget, binaryLimits, binaryRejection } from './binary-guards.js';

function seed(name, source) {
  const result = compileToIL(source, {
    name: 'FuzzAssembly', includeDebug: true, embedSources: false, portablePdb: false,
  });
  if (!result.success) throw new Error('Self-authored PE seed did not compile');
  return { name, input: result.assembly };
}

function preflight(input, limits) {
  const pe = readPE(input, { maxBytes: limits.maxInputBytes, inspection: true });
  const rows = Object.values(pe.metadata.counts).reduce((sum, count) => sum + count, 0);
  if (rows > 256) return binaryRejection('PE_ROW_LIMIT');
  const diagnostics = validateMetadata(pe.metadata, { maxDiagnostics: 1, signal: limits.signal });
  if (diagnostics.length) return binaryRejection(diagnostics[0].code, diagnostics[0].message);
  let methodBytes = 0;
  for (let index = 0; index < (pe.metadata.counts[6] ?? 0); index++) {
    methodBytes += readMethodHeader(pe, 0x06000001 + index)?.codeSize ?? 0;
    if (methodBytes > limits.maxOutputBytes) return binaryRejection('PE_METHOD_BYTES_LIMIT');
  }
  const debug = pe.metadata.streams.get('#SF');
  if (!debug) return null;
  try {
    return binaryJsonBudget(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(debug)));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
      throw new CilError('Invalid SharpForge CIL metadata');
    }
    throw error;
  }
}

function inspect(input, limits) {
  const inspector = new AssemblyInspector(input, { maxBytes: limits.maxInputBytes, maxInstructions: 4096 });
  for (const method of inspector.methods.values()) inspector.getMethod(method.token);
}

/** Inspect and load PE/metadata as data; execution and native assembly loading are outside this target. */
export const target = Object.freeze({
  id: 'pe-loader',
  createSeeds() {
    return [
      seed('return-int', 'class FuzzSeed { public static int Main() { return 7; } }'),
      seed('branch-and-local', 'class FuzzSeed { public static int Main() { int x = 7; if (x > 3) x += 2; return x; } }'),
    ];
  },
  run(input, context) {
    const limits = binaryLimits(input, context);
    const admission = binaryAdmission(input, limits);
    if (admission) return admission;
    try {
      const failure = preflight(input, limits);
      if (failure) return failure;
    } catch (error) {
      return binaryFailure(error, CilError, 'PE_VALIDATION');
    }
    let inspectionFailure;
    try {
      inspect(input, limits);
    } catch (error) {
      inspectionFailure = binaryFailure(error, CilError, 'PE_VALIDATION');
    }
    try {
      loadAssembly(input, { maxBytes: limits.maxInputBytes });
      return inspectionFailure ?? { status: 'accepted', code: 'PE_INSPECTED_AND_LOADED' };
    } catch (error) {
      return binaryFailure(error, CilError, 'PE_VALIDATION');
    }
  },
});
