import { crc32, deflateDynamic } from '@sharpforge/archive';

function chunk(name, bytes) {
  const type = new TextEncoder().encode(name);
  const output = new Uint8Array(bytes.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, bytes.length);
  output.set(type, 4);
  output.set(bytes, 8);
  view.setUint32(bytes.length + 8, crc32(output.subarray(4, bytes.length + 8)));
  return output;
}

/** Deterministic RGBA PNG assets with dimensions required by the generated MSIX manifest. */
export function templateLogo(width, height) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const offset = row * (width * 4 + 1) + 1 + column * 4;
      raw.set([37, 99, 235, 255], offset);
    }
  }
  let first = 1;
  let second = 0;
  for (const byte of raw) { first = (first + byte) % 65521; second = (second + first) % 65521; }
  const compressed = deflateDynamic(raw);
  const zlib = new Uint8Array(compressed.length + 6);
  zlib.set([0x78, 0x9c]);
  zlib.set(compressed, 2);
  new DataView(zlib.buffer).setUint32(zlib.length - 4, ((second << 16) | first) >>> 0);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())];
  const output = new Uint8Array(parts.reduce((length, bytes) => length + bytes.length, 0));
  let offset = 0;
  for (const bytes of parts) { output.set(bytes, offset); offset += bytes.length; }
  return output;
}
