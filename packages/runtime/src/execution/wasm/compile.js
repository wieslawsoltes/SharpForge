import {encodeWasmIR} from './encoder.js';
import {wasmImportSignatures} from './encoding-profile.js';

function failure(code, message, cause) {
  return Object.assign(new Error(message, {cause}), {code});
}

function importsFor(ir, helpers) {
  if (!helpers || typeof helpers !== 'object' || Array.isArray(helpers)) throw new TypeError('Wasm runtime helpers are required');
  const runtime = {};
  const names = new Set(wasmImportSignatures.map(signature => signature.name));
  for (const name of Object.keys(helpers)) if (!names.has(name)) throw new TypeError('Unknown Wasm runtime helper: ' + name);
  for (const name of names) {
    const helper = Object.hasOwn(helpers, name) ? helpers[name] : null;
    if (typeof helper !== 'function') throw new TypeError('Missing Wasm runtime helper: ' + name);
    runtime[name] = helper;
  }
  const guard = runtime.guard;
  runtime.guard = pc => {
    const accepted = guard(pc, ir.instructions[pc].inputs);
    if (typeof accepted !== 'boolean') throw new TypeError('Wasm operand guard must return a boolean');
    return Number(accepted);
  };
  return {runtime};
}

/** Asynchronously instantiate validated IR with host-owned helpers; no VM or tiering state is installed. */
export async function instantiateWasmIR(ir, helpers, options = {}) {
  const bytes = encodeWasmIR(ir, options);
  const imports = importsFor(ir, helpers);
  const backend = globalThis.WebAssembly;
  if (typeof backend?.instantiate !== 'function') throw failure('WASM_UNAVAILABLE', 'WebAssembly.instantiate is unavailable');
  try {
    const {module, instance} = await backend.instantiate(bytes, imports);
    return Object.freeze({module, instance, byteLength: bytes.length});
  } catch (error) {
    throw failure('WASM_COMPILE', 'WebAssembly instantiation failed: ' + (error.message ?? String(error)), error);
  }
}
