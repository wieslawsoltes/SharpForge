import {DrawingError} from '../drawing/commands.js';

// hb_font_extents_t has three public positions and nine reserved positions, all int32 in the pinned Wasm ABI.
// Native definition: https://github.com/harfbuzz/harfbuzz/blob/main/src/hb-font.h
const extentBytes = 12 * 4;

/** Read scaled horizontal font metrics without hbjs 0.8.0's undersized 12-byte stack allocation.
 * The complete 48-byte native struct is owned until the call returns, then released even on failure.
 */
export function harfBuzzMetrics(module, font) {
  const api = module.wasmExports;
  const pointer = api.malloc(extentBytes);
  if (!pointer) throw new DrawingError('SFRENDER144', 'HarfBuzz metric allocation failed');
  try {
    if (!api.hb_font_get_h_extents(font.ptr, pointer)) {
      throw new DrawingError('SFRENDER140', 'Loaded font has no horizontal metrics');
    }
    const view = new DataView(module.wasmMemory.buffer, pointer, extentBytes);
    return {ascender: view.getInt32(0, true), descender: view.getInt32(4, true), lineGap: view.getInt32(8, true)};
  } finally {
    api.free(pointer);
  }
}
