function sizeClass(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 2 ** 30) throw new RangeError('Invalid GPU allocation size');
  return 2 ** Math.ceil(Math.log2(Math.max(256, bytes)));
}

class ResourcePool {
  constructor(service, {maxBytes = 64 * 1024 * 1024} = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid pool byte budget');
    this.service = service;
    this.maxBytes = maxBytes;
    this.free = new Map();
    this.live = new Set();
    this.bytes = 0;
    this.closed = false;
    this.unsubscribe = service.subscribe(event => {
      if (event.state === 'lost' || event.state === 'disposed') this.clear();
    });
  }

  take(key, bytes, create, upload = true) {
    if (this.closed) throw new Error('GPU pool is disposed');
    if (!this.service.device || this.service.state !== 'ready') throw new Error('GPU device is not ready');
    const available = this.free.get(key);
    const lease = available?.pop() ?? {
      resource: create(this.service.device), size: bytes, bytes: upload ? new Uint8Array(bytes) : null, key,
      epoch: this.service.epoch, pool: this, active: false, discarded: false
    };
    if (available && !available.length) this.free.delete(key);
    if (!this.live.has(lease)) {
      this.live.add(lease);
      this.bytes += bytes;
    }
    lease.active = true;
    return lease;
  }

  release(lease, ticket) {
    if (!lease || lease.pool !== this || !lease.active) throw new TypeError('Foreign or released GPU pool lease');
    lease.active = false;
    if (ticket) this.service.retirement.use(lease.resource, ticket);
    // Publish only after RetirementQueue clears its pending entry, not from inside the retirement callback.
    return this.service.retirement.retire(lease.resource, () => {}).then(() => {
      if (this.closed || lease.discarded || lease.epoch !== this.service.epoch || this.bytes > this.maxBytes) {
        this.destroy(lease);
        return;
      }
      const available = this.free.get(lease.key) ?? [];
      available.push(lease);
      this.free.set(lease.key, available);
    });
  }

  destroy(lease) {
    if (!this.live.delete(lease)) return;
    lease.resource.destroy?.();
    lease.discarded = true;
    this.bytes -= lease.size;
  }

  clear() {
    this.free.clear();
    for (const lease of this.live) {
      lease.discarded = true;
      if (!lease.active) this.service.retirement.retire(lease.resource, () => this.destroy(lease));
    }
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.clear();
    const pending = [];
    for (const lease of this.live) {
      lease.active = false;
      pending.push(this.service.retirement.retire(lease.resource, () => this.destroy(lease)));
    }
    await Promise.all(pending);
  }
}

/** Leases retain their typed upload storage across frames; a pending lease is never reused. */
export class BufferPool extends ResourcePool {
  acquire(size, usage) {
    const bytes = sizeClass(size);
    if (!Number.isInteger(usage) || usage <= 0) throw new RangeError('GPU buffer usage is required');
    return this.take(`${bytes}:${usage}`, bytes, device => device.createBuffer({size: bytes, usage}));
  }
}

/** Textures are keyed by their complete allocation descriptor, including usage and sample count. */
export class TexturePool extends ResourcePool {
  acquire(descriptor) {
    const {format = 'rgba8unorm', usage, sampleCount = 1, dimension = '2d', mipLevelCount = 1} = descriptor;
    const size = descriptor.size;
    const width = Array.isArray(size) ? size[0] : size?.width;
    const height = Array.isArray(size) ? (size[1] ?? 1) : (size?.height ?? 1);
    const depth = Array.isArray(size) ? (size[2] ?? 1) : (size?.depthOrArrayLayers ?? 1);
    if (![width, height, depth, mipLevelCount, sampleCount].every(value => Number.isInteger(value) && value > 0)) {
      throw new RangeError('Invalid GPU texture dimensions');
    }
    if (width > 16384 || height > 16384 || depth > 2048) throw new RangeError('GPU texture size limit exceeded');
    const bytesPerPixel = ({rgba16float: 8, rgba32float: 16, r8unorm: 1, rg8unorm: 2})[format] ?? 4;
    const bytes = Math.ceil(width * height * depth * bytesPerPixel * sampleCount * (mipLevelCount > 1 ? 4 / 3 : 1));
    if (!Number.isSafeInteger(bytes) || bytes > 2 ** 30) throw new RangeError('GPU texture byte limit exceeded');
    const key = `${width}:${height}:${depth}:${format}:${usage}:${sampleCount}:${dimension}:${mipLevelCount}`;
    return this.take(key, bytes, device => device.createTexture(descriptor), false);
  }
}
