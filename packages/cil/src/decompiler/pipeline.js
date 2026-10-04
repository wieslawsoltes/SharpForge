import { AssemblyInspector } from '../inspector.js';
import { formatAssembly } from '../disassembler.js';
import { reconstructCSharp } from './csharp.js';

function inspectorFor(input) {
  return input instanceof AssemblyInspector ? input : new AssemblyInspector(input);
}

function methodIdentity(method) {
  return { token: method.token, name: `${method.owner}::${method.name}` };
}

/** Decode once, then lower through the conservative C# stage or retain complete IL with a diagnostic. */
export function decompileMethod(input, methodToken) {
  const inspector = inspectorFor(input);
  const method = inspector.getMethod(methodToken);
  if (!method.hasBody) {
    return { ...methodIdentity(method), language: 'csharp', complete: false,
      diagnostics: [{ code: 'NO_IL_BODY', message: 'Abstract, native or runtime-supplied method has no CIL body' }],
      source: `// No IL body: ${inspector.describeToken(method.token)}` };
  }
  try {
    const source = reconstructCSharp(inspector, method);
    return { ...methodIdentity(method), language: 'csharp', complete: true, diagnostics: [], source };
  } catch (error) {
    return { ...methodIdentity(method), language: 'cil', complete: false,
      diagnostics: [{ code: 'DECOMPILER_FALLBACK', message: error.message }],
      source: formatAssembly(inspector.pe.bytes, { methodToken: method.token }) };
  }
}

/** Decompile each inspected method while preserving per-method failures and whole-assembly source output. */
export function decompileAssembly(input) {
  const inspector = inspectorFor(input);
  const methods = [];
  for (const method of inspector.methods.values()) {
    try {
      methods.push(decompileMethod(inspector, method.token));
    } catch (error) {
      methods.push({ ...methodIdentity(method), language: 'cil', complete: false, source: `// ${error.message}`,
        diagnostics: [{ code: 'INVALID_METHOD', message: error.message }] });
    }
  }
  return { name: inspector.summary({ includeMethods: false }).name, methods,
    reconstructed: methods.filter(method => method.complete).length, total: methods.length,
    source: methods.map(method => `// ${method.name}\n${method.source}`).join('\n') };
}
