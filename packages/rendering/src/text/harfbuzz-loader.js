import {createHarfBuzz} from '../../vendor/harfbuzz/hb.js';
import {hbjs} from '../../vendor/harfbuzz/hbjs.js';
import {DrawingError} from '../drawing/commands.js';

const maximumWasmBytes = 8 * 1024 * 1024;

function ownedBytes(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > maximumWasmBytes) {
    throw new DrawingError('SFRENDER082', 'HarfBuzz requires a bounded WebAssembly byte buffer');
  }
  return new Uint8Array(bytes);
}

/** Create an isolated HarfBuzz engine from supplied bytes or an explicitly authorized binary loader.
 * The caller owns the returned engine and must release its HarfBuzz faces, fonts and buffers.
 * This function performs no implicit network requests and never shares mutable Wasm memory across applications.
 */
export async function loadBundledHarfBuzz({wasmBinary, loadBinary, wasmURL, signal} = {}) {
  signal?.throwIfAborted();
  if (wasmBinary === undefined) {
    if (typeof loadBinary !== 'function' || !(typeof wasmURL === 'string' && wasmURL.length > 0 || wasmURL instanceof URL)) {
      throw new DrawingError('SFRENDER080', 'Supply HarfBuzz bytes or an authorized loadBinary callback and wasmURL');
    }
    wasmBinary = await loadBinary(wasmURL, {signal});
    signal?.throwIfAborted();
  }
  const bytes = ownedBytes(wasmBinary);
  const module = await createHarfBuzz({wasmBinary: bytes,
    print: () => {}, printErr: message => { throw new DrawingError('SFRENDER084', 'HarfBuzz initialization failed: ' + message); }});
  signal?.throwIfAborted();
  return {module, hb: hbjs(module)};
}
