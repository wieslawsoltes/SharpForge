import {DrawingError, finite, rectangle} from '../drawing/commands.js';

/** App-local bounded decoder. URL loading must be supplied by the host's origin-grant transport. */
export class ImageCache {
  constructor({decode = globalThis.createImageBitmap?.bind(globalThis), load = null,
    maxPixels = 16777216, maxBytes = 128 * 1024 * 1024} = {}) {
    if (![maxPixels, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new DrawingError('SFRENDER063', 'Invalid image cache budget');
    this.decode = decode; this.load = load; this.maxPixels = maxPixels; this.maxBytes = maxBytes;
    this.entries = new Map(); this.bytes = 0; this.serial = 0; this.disposed = false;
    this.owners = new WeakMap(); this.objectKeys = new WeakMap();
  }
  async get(source, {width, height, signal, key = source, retain = false} = {}) {
    if (this.disposed) throw new DrawingError('SFRENDER060', 'Image cache is disposed');
    signal?.throwIfAborted();
    const sizeKey = `${width ?? ''}:${height ?? ''}`;
    let cacheKey = typeof key === 'string' ? `${key}:${sizeKey}` : key;
    if (key && typeof key === 'object') {
      let sizes = this.objectKeys.get(key); if (!sizes) { sizes = new Map(); this.objectKeys.set(key, sizes); }
      if (!sizes.has(sizeKey)) sizes.set(sizeKey, Object.freeze({key, sizeKey}));
      cacheKey = sizes.get(sizeKey);
    }
    const cached = this.entries.get(cacheKey);
    if (cached) { cached.used = ++this.serial; if (retain) cached.references++; return cached.value; }
    let input = source;
    if (typeof input === 'string') {
      if (!this.load) throw new DrawingError('SFRENDER061', 'Image URLs require an authorized host loader');
      input = await this.load(input, {signal});
    }
    signal?.throwIfAborted();
    if (!this.decode) throw new DrawingError('SFRENDER062', 'ImageBitmap decoder is unavailable');
    if (input?.size > this.maxBytes) throw new DrawingError('SFRENDER063', 'Encoded image exceeds byte budget');
    const options = {premultiplyAlpha: 'premultiply', colorSpaceConversion: 'default', imageOrientation: 'from-image'};
    if (width !== undefined) options.resizeWidth = finite(width, 'decode width', 1, 16384);
    if (height !== undefined) options.resizeHeight = finite(height, 'decode height', 1, 16384);
    if ([width, height].some(value => value !== undefined && !Number.isInteger(value))) throw new DrawingError('SFRENDER063', 'Decode dimensions must be integers');
    const bitmap = await this.decode(input, options);
    if (this.disposed || signal?.aborted) { bitmap.close?.(); signal?.throwIfAborted(); throw new DrawingError('SFRENDER060', 'Image cache disposed during decode'); }
    const pixels = bitmap.width * bitmap.height, bytes = pixels * 4;
    if (![bitmap.width, bitmap.height].every(value => Number.isInteger(value) && value > 0 && value <= 16384) ||
      pixels > this.maxPixels || bytes > this.maxBytes) {
      bitmap.close?.(); throw new DrawingError('SFRENDER063', 'Decoded image exceeds pixel budget');
    }
    const winner = this.entries.get(cacheKey);
    if (winner) { bitmap.close?.(); winner.used = ++this.serial; if (retain) winner.references++; return winner.value; }
    while (this.bytes + bytes > this.maxBytes && this.entries.size) {
      let oldest;
      for (const entry of this.entries) if (!entry[1].references && (!oldest || entry[1].used < oldest[1].used)) oldest = entry;
      if (!oldest) break;
      oldest[1].value.source.close?.(); this.bytes -= oldest[1].bytes; this.entries.delete(oldest[0]);
      this.owners.delete(oldest[1].value);
    }
    if (this.bytes + bytes > this.maxBytes) { bitmap.close?.(); throw new DrawingError('SFRENDER063', 'Live image resources exhaust the decode cache'); }
    const value = {kind: 'image', source: bitmap, width: bitmap.width, height: bitmap.height,
      colorSpace: 'srgb', alphaMode: 'premultiplied', version: 0};
    const entry = {value, bytes, used: ++this.serial, references: retain ? 1 : 0};
    this.entries.set(cacheKey, entry); this.owners.set(value, entry); this.bytes += bytes;
    return value;
  }
  async acquire(source, options) {
    const image = await this.get(source, {...options, retain: true}), entry = this.owners.get(image);
    let released = false;
    return {image, release: () => { if (!released) { released = true; entry.references--; } }};
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) entry.value.source.close?.();
    this.entries.clear(); this.bytes = 0;
    this.owners = new WeakMap(); this.objectKeys = new WeakMap();
  }
}

/** Source/destination rectangles for Stretch and alignment, without modifying image aspect ratio. */
export function imageRectangle(image, destination, {stretch = 1, alignmentX = 1, alignmentY = 1, source = null} = {}) {
  const src = rectangle(source ?? [0, 0, image.width, image.height]), dst = rectangle(destination);
  const kind = typeof stretch === 'string' ? stretch.toLowerCase() : ['none', 'fill', 'uniform', 'uniformtofill'][stretch];
  if (!src[2] || !src[3] || !dst[2] || !dst[3]) return {source: src, destination: [dst[0], dst[1], 0, 0]};
  if (kind === 'fill') return clipImagePatch(image, src, dst);
  const sx = dst[2] / src[2], sy = dst[3] / src[3];
  const scale = kind === 'none' ? 1 : kind === 'uniform' ? Math.min(sx, sy) : kind === 'uniformtofill' ? Math.max(sx, sy) : null;
  if (scale === null) throw new DrawingError('SFRENDER064', 'Unsupported image Stretch');
  const factor = value => {
    const result = typeof value === 'number' ? value / 2 : {left: 0, top: 0, center: 0.5, right: 1, bottom: 1}[value];
    return finite(result, 'image alignment', 0, 1);
  };
  const width = src[2] * scale, height = src[3] * scale;
  return clipImagePatch(image, src, [dst[0] + (dst[2] - width) * factor(alignmentX),
    dst[1] + (dst[3] - height) * factor(alignmentY), width, height]);
}

function clipImagePatch(image, source, destination) {
  const left = Math.max(0, source[0]), top = Math.max(0, source[1]);
  const width = Math.max(0, Math.min(image.width, source[0] + source[2]) - left);
  const height = Math.max(0, Math.min(image.height, source[1] + source[3]) - top);
  const sx = destination[2] / source[2], sy = destination[3] / source[3];
  return {source: [left, top, width, height], destination: [destination[0] + (left - source[0]) * sx,
    destination[1] + (top - source[1]) * sy, width * sx, height * sy]};
}

/** Nine-slice patches preserve source corners; undersized destinations scale corner pairs proportionally. */
export function nineGridPatches(image, destination, insets) {
  const [x, y, width, height] = rectangle(destination);
  let [left, top, right, bottom] = Array.isArray(insets) ? insets : [insets.Left, insets.Top, insets.Right, insets.Bottom];
  for (const value of [left, top, right, bottom]) finite(value, 'NineGrid inset', 0, 16384);
  const sourceScaleX = Math.min(1, image.width / (left + right || 1)), sourceScaleY = Math.min(1, image.height / (top + bottom || 1));
  left *= sourceScaleX; right *= sourceScaleX; top *= sourceScaleY; bottom *= sourceScaleY;
  const dx = Math.min(1, width / (left + right || 1)), dy = Math.min(1, height / (top + bottom || 1));
  const sourceX = [0, left, image.width - right, image.width], sourceY = [0, top, image.height - bottom, image.height];
  const targetX = [x, x + left * dx, x + width - right * dx, x + width];
  const targetY = [y, y + top * dy, y + height - bottom * dy, y + height], result = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    result.push({source: [sourceX[column], sourceY[row], sourceX[column + 1] - sourceX[column], sourceY[row + 1] - sourceY[row]],
      destination: [targetX[column], targetY[row], targetX[column + 1] - targetX[column], targetY[row + 1] - targetY[row]]});
  }
  return result;
}

export class WriteableBitmap {
  constructor(width, height) {
    this.width = finite(width, 'bitmap width', 1, 16384); this.height = finite(height, 'bitmap height', 1, 16384);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width * height > 16777216) {
      throw new DrawingError('SFRENDER063', 'Invalid bitmap dimensions');
    }
    this.pixels = new Uint8ClampedArray(width * height * 4); this.version = 0; this.listeners = new Set();
  }
  get PixelBuffer() { return this.pixels; }
  get PixelWidth() { return this.width; }
  get PixelHeight() { return this.height; }
  get Revision() { return this.version; }
  get revision() { return this.version; }
  Invalidate() {
    if (!this.pixels) throw new DrawingError('SFRENDER060', 'Bitmap is disposed');
    this.version++; for (const listener of this.listeners) listener(this);
  }
  invalidate() { this.Invalidate(); }
  setPixels(pixels) {
    if (!this.pixels) throw new DrawingError('SFRENDER060', 'Bitmap is disposed');
    if (!ArrayBuffer.isView(pixels) || pixels.byteLength !== this.pixels.byteLength) {
      throw new DrawingError('SFRENDER063', 'RGBA pixel buffer size does not match the bitmap');
    }
    this.pixels.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
    this.Invalidate();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  on(name, listener) {
    if (name !== 'Invalidated') throw new DrawingError('SFRENDER063', 'Unknown bitmap notification');
    return this.subscribe(bitmap => listener({Revision: bitmap.version}));
  }
  snapshot() {
    if (!this.pixels) throw new DrawingError('SFRENDER060', 'Bitmap is disposed');
    return {version: 1, width: this.width, height: this.height, pixels: this.pixels.slice(), revision: this.version};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.width !== this.width || snapshot.height !== this.height
      || !ArrayBuffer.isView(snapshot.pixels) || snapshot.pixels.byteLength !== this.width * this.height * 4
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new DrawingError('SFRENDER063', 'Bitmap snapshot does not match its dimensions or revision');
    }
    this.pixels ??= new Uint8ClampedArray(this.width * this.height * 4);
    this.pixels.set(new Uint8Array(snapshot.pixels.buffer, snapshot.pixels.byteOffset, snapshot.pixels.byteLength));
    this.version = snapshot.revision;
  }
  dispose({preserveValues = false} = {}) { this.listeners.clear(); if (!preserveValues) this.pixels = null; }
}

export class RenderTargetBitmap {
  constructor({createCanvas, createBackend} = {}) { this.createCanvas = createCanvas; this.createBackend = createBackend; this.pixels = null; }
  async RenderAsync(list, resources, {width, height, dpr = 1, signal} = {}) {
    signal?.throwIfAborted();
    if (!this.createCanvas || !this.createBackend) throw new DrawingError('SFRENDER065', 'RenderTargetBitmap needs a rendering host');
    const canvas = this.createCanvas(Math.ceil(width * dpr), Math.ceil(height * dpr));
    const backend = this.createBackend(canvas);
    try {
      await backend.render(list, resources, {width, height, dpr}); signal?.throwIfAborted();
      this.pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      this.PixelWidth = canvas.width; this.PixelHeight = canvas.height;
    } finally { backend.dispose?.(); }
  }
  async GetPixelsAsync() { if (!this.pixels) throw new DrawingError('SFRENDER065', 'RenderAsync must complete first'); return this.pixels.slice(); }
}
