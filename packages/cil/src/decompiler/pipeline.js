import { AssemblyInspector } from '../inspector.js';
import { formatAssembly } from '../disassembler.js';
import { reconstructCSharp } from './csharp.js';
import { decodedControlFlowGraph } from './cfg.js';
import { controlFlowCancellation, controlFlowOptions, isControlFlowInterruption } from './cfg-contracts.js';

function inspectorFor(input) {
  return input instanceof AssemblyInspector ? input : new AssemblyInspector(input);
}

function methodIdentity(method) {
  return { token: method.token, name: `${method.owner}::${method.name}` };
}

/** Decode once, build normal control flow, then lower conservatively or retain complete IL with a diagnostic.
 * The owned controlFlowGraph remains available on source fallback. Invalid options, limits and cancellation throw. */
export function decompileMethod(input, methodToken, options = {}) {
  const limits = controlFlowOptions(options);
  const inspector = inspectorFor(input);
  const method = inspector.getMethod(methodToken);
  if (!method.hasBody) {
    return { ...methodIdentity(method), language: 'csharp', complete: false,
      diagnostics: [{ code: 'NO_IL_BODY', message: 'Abstract, native or runtime-supplied method has no CIL body' }],
      source: `// No IL body: ${inspector.describeToken(method.token)}`, controlFlowGraph: null };
  }
  let controlFlowGraph = null;
  try {
    controlFlowGraph = decodedControlFlowGraph(method, limits);
    const source = reconstructCSharp(inspector, method, controlFlowGraph, limits.signal);
    return { ...methodIdentity(method), language: 'csharp', complete: true, diagnostics: [], source, controlFlowGraph };
  } catch (error) {
    if (isControlFlowInterruption(error)) throw error;
    const code = /^(CILCFG|CILR)/.test(error.code) ? error.code : 'DECOMPILER_FALLBACK';
    const diagnostic = { code, message: error.message };
    if (code !== 'DECOMPILER_FALLBACK') Object.assign(diagnostic, { severity: 'error', offset: error.offset ?? null });
    return { ...methodIdentity(method), language: 'cil', complete: false,
      diagnostics: [diagnostic],
      source: formatAssembly(inspector.pe.bytes, { methodToken: method.token }), controlFlowGraph };
  }
}

/** Decompile each inspected method while preserving per-method failures and whole-assembly source output. */
export function decompileAssembly(input, options = {}) {
  const limits = controlFlowOptions(options);
  const inspector = inspectorFor(input);
  const methods = [];
  for (const method of inspector.methods.values()) {
    controlFlowCancellation(limits.signal);
    try {
      methods.push(decompileMethod(inspector, method.token, limits));
    } catch (error) {
      if (isControlFlowInterruption(error)) throw error;
      methods.push({ ...methodIdentity(method), language: 'cil', complete: false, source: `// ${error.message}`,
        diagnostics: [{ code: 'INVALID_METHOD', message: error.message }], controlFlowGraph: null });
    }
  }
  return { name: inspector.summary({ includeMethods: false }).name, methods,
    reconstructed: methods.filter(method => method.complete).length, total: methods.length,
    source: methods.map(method => `// ${method.name}\n${method.source}`).join('\n') };
}
