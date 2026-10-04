import {DrawingError} from '../drawing/commands.js';
import {gradientColor} from '../brushes/brushes.js';
import {mipLayout, generateMipmaps} from './mipmaps.js';
import {uploadAtlasChanges} from './atlas-upload.js';

const usage = {COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16};

/** Device-epoch cache uploads changed resources once, with explicit premultiplication and bounded residency. */
export class TextureCache {
  constructor(service, {maxBytes = 128 * 1024 * 1024} = {}) {
    this.service = service; this.maxBytes = maxBytes; this.entries = new Map(); this.bytes = 0; this.serial = 0;
    this.orphans = new Set(); this.pinTarget = null;
    this.unsubscribe = service.subscribe(event => { if (event.state === 'lost' || event.state === 'disposed') this.clear(); });
  }
  get(key, image, {version = image.version ?? 0, sampling = 'linear', spread = 'pad'} = {}) {
    const old = this.entries.get(key);
    if (old && image.appendOnly && old.width === image.width && old.height === image.height && old.version !== version) {
      uploadAtlasChanges(this.service.device.queue, old.texture, image);
      old.version = version;
    }
    if (old && old.version === version && old.sampling === sampling && old.spread === spread) {
      old.used = ++this.serial; this.pinTarget?.pinTexture(old); return old;
    }
    if (old) this.remove(key, old);
    const width = image.width, height = image.height;
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= (this.service.device.limits?.maxTextureDimension2D ?? 8192))) {
      throw new DrawingError('SFRENDER095', 'Texture exceeds residency budget');
    }
    const mip = mipLayout(width, height, !image.appendOnly && image.mipmaps !== false), bytes = mip.bytes;
    if (bytes > this.maxBytes || image.pixels && image.pixels.length !== width * height * 4) {
      throw new DrawingError('SFRENDER095', 'Texture residency or pixel byte count is invalid');
    }
    while (this.bytes + bytes > this.maxBytes && this.entries.size) {
      let oldest;
      for (const pair of this.entries) if (!pair[1].pins && (!oldest || pair[1].used < oldest[1].used)) oldest = pair;
      if (!oldest) break;
      this.remove(...oldest);
    }
    if (this.bytes + bytes > this.maxBytes) throw new DrawingError('SFRENDER095', 'Live display lists exhaust the texture residency budget');
    const device = this.service.device, texture = device.createTexture({label: 'SharpForge cached image', size: [width, height], mipLevelCount: mip.levels.length,
      format: 'rgba8unorm', usage: usage.COPY_DST | usage.TEXTURE_BINDING | usage.RENDER_ATTACHMENT});
    try {
    if (image.pixels) {
      const premultiplied = new Uint8Array(image.pixels.length);
      for (let index = 0; index < image.pixels.length; index += 4) {
        const alpha = image.pixels[index + 3];
        for (let channel = 0; channel < 3; channel++) premultiplied[index + channel] =
          image.alphaMode === 'premultiplied' ? image.pixels[index + channel] : Math.round(image.pixels[index + channel] * alpha / 255);
        premultiplied[index + 3] = alpha;
      }
      device.queue.writeTexture({texture}, premultiplied, {bytesPerRow: width * 4}, [width, height]);
    } else device.queue.copyExternalImageToTexture({source: image.source}, {texture, premultipliedAlpha: true, colorSpace: 'srgb'}, [width, height]);
    const addressMode = spread === 'repeat' ? 'repeat' : spread === 'reflect' ? 'mirror-repeat' : 'clamp-to-edge';
    generateMipmaps(this.service, texture, mip.levels);
    const sampler = device.createSampler({minFilter: sampling, magFilter: sampling, mipmapFilter: sampling,
      addressModeU: addressMode, addressModeV: 'clamp-to-edge'});
    const entry = {texture, view: texture.createView(), sampler, bytes, width, height, version, sampling, spread,
      pins: 0, used: ++this.serial, epoch: this.service.epoch};
    this.entries.set(key, entry); this.bytes += bytes; this.pinTarget?.pinTexture(entry); return entry;
    } catch (error) { this.service.retirement.retire(texture); throw error; }
  }
  gradient(brush) {
    const key = JSON.stringify(['gradient', brush.stops, brush.interpolation, brush.spread]), old = this.entries.get(key);
    if (old) { old.used = ++this.serial; this.pinTarget?.pinTexture(old); return old; }
    const width = 4096, pixels = new Uint8Array(width * 4);
    for (let x = 0; x < width; x++) {
      const color = gradientColor({...brush, spread: 'pad'}, x / (width - 1));
      for (let channel = 0; channel < 4; channel++) pixels[x * 4 + channel] = Math.round(color[channel] * 255);
    }
    return this.get(key, {width, height: 1, pixels, alphaMode: 'straight'}, {spread: brush.spread});
  }
  markUsed(entry, ticket) { this.service.retirement.use(entry.texture, ticket); }
  retain(entry) { entry.pins++; }
  release(entry) {
    if (entry.pins) entry.pins--;
    if (!entry.pins && this.orphans.delete(entry)) this.destroy(entry);
  }
  destroy(entry) { this.bytes -= entry.bytes; this.service.retirement.retire(entry.texture); }
  remove(key, entry) {
    if (!this.entries.delete(key)) return;
    if (entry.pins) this.orphans.add(entry); else this.destroy(entry);
  }
  clear() { for (const pair of [...this.entries]) this.remove(...pair); }
  dispose() { this.unsubscribe(); this.clear(); }
}
