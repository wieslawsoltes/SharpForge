import {DrawingError} from '../drawing/commands.js';

const pngSignature = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Object.freeze(Array.from({length: 256}, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
}));

export function bitmapMetrics(table, offset, big) {
  table.range(offset, big ? 8 : 5);
  return Object.freeze({height: table.u8(offset), width: table.u8(offset + 1), bearingX: table.i8(offset + 2),
    bearingY: table.i8(offset + 3), advance: table.u8(offset + 4)});
}

export function readColorBitmap(table, record, maxImageBytes) {
  const format = record.imageFormat, header = format === 17 ? 5 : format === 18 ? 8 : 0;
  const metrics = header ? bitmapMetrics(table, 0, format === 18) : record.metrics;
  if (!metrics || !metrics.width || !metrics.height) corrupt('Color bitmap metrics require positive dimensions');
  const length = table.u32(header), offset = header + 4;
  if (!length || length > maxImageBytes) corrupt('PNG glyph exceeds its image byte budget');
  const png = table.sub(offset, length);
  validatePng(png, metrics);
  // No PNG copy: OpenTypeFont owns the backing bytes, and the strike caches this descriptor.
  const bytes = new Uint8Array(png.bytes.buffer, png.bytes.byteOffset + png.offset, png.length);
  return {...metrics, png: bytes};
}

function validatePng(table, metrics) {
  if (pngSignature.some((byte, index) => table.u8(index) !== byte)) corrupt('Invalid PNG glyph signature');
  let cursor = 8, chunks = 0, idat = false, endedData = false, colorType = null, paletteEntries = 0;
  const seen = new Set();
  while (cursor < table.length) {
    if (++chunks > 8192) corrupt('PNG glyph chunk count exceeds its budget');
    const length = table.u32(cursor), tag = table.tag(cursor + 4), start = cursor + 8, end = start + length;
    table.range(start, length + 4);
    if (crc32(table, cursor + 4, length + 4) !== table.u32(end)) corrupt('PNG glyph chunk checksum is invalid');
    if (!['IHDR', 'PLTE', 'tRNS', 'sRGB', 'IDAT', 'IEND'].includes(tag)) {
      throw new DrawingError('SFRENDER146', `Unsupported CBDT PNG chunk '${tag}'`);
    }
    if (!seen.has('IHDR') && tag !== 'IHDR') corrupt('PNG glyph must begin with IHDR');
    if (tag !== 'IDAT' && seen.has(tag)) corrupt('Duplicate PNG glyph chunk');
    if (tag === 'IHDR') colorType = readHeader(table.sub(start, length), metrics);
    else if (tag === 'IDAT') {
      if (endedData || colorType === 3 && !paletteEntries) corrupt('Invalid PNG glyph image-data order');
      idat = true;
    } else if (tag === 'IEND') {
      if (length || !idat || end + 4 !== table.length) corrupt('Invalid PNG glyph end chunk');
      return;
    } else {
      if (idat) corrupt('PNG glyph color metadata follows image data');
      if (tag === 'PLTE') {
        if (!length || length % 3 || length > 768 || colorType === 0 || colorType === 4) corrupt('Invalid PNG glyph palette');
        paletteEntries = length / 3;
      } else if (tag === 'tRNS') validateTransparency(colorType, length, paletteEntries);
      else if (length !== 1 || table.u8(start) > 3) corrupt('Invalid PNG glyph sRGB intent');
    }
    if (idat && tag !== 'IDAT') endedData = true;
    seen.add(tag);
    cursor = end + 4;
  }
  corrupt('PNG glyph has no end chunk');
}

function readHeader(table, metrics) {
  if (table.length !== 13 || table.u32(0) !== metrics.width || table.u32(4) !== metrics.height) {
    corrupt('PNG glyph dimensions do not match bitmap metrics');
  }
  const depth = table.u8(8), color = table.u8(9);
  const depths = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
  if (!depths[color]?.includes(depth) || table.u8(10) || table.u8(11) || table.u8(12) > 1) corrupt('Invalid PNG glyph pixel format');
  return color;
}

function validateTransparency(color, length, paletteEntries) {
  if (color === 0 && length === 2 || color === 2 && length === 6
    || color === 3 && length > 0 && length <= paletteEntries) return;
  corrupt('Invalid PNG glyph transparency');
}

function crc32(table, offset, length) {
  let value = 0xffffffff;
  for (let index = offset; index < offset + length; index++) value = crcTable[(value ^ table.u8(index)) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}

function corrupt(message) { throw new DrawingError('SFRENDER140', message); }
