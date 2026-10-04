import {RetirementQueue} from './retirement.js';

const pipelineCaches = () => ({vector: new Map(), effect: new Map(), mipmap: new Map()});

/** One explicitly owned device service serves all surfaces of an application. */
export class GpuDevice {
  constructor({gpu = globalThis.navigator?.gpu, adapterOptions, deviceDescriptor, maxRetries = 2, onStateChange} = {}) {
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 16) throw new RangeError('Invalid GPU retry limit');
    this.gpu = gpu;
    this.adapterOptions = adapterOptions;
    this.deviceDescriptor = deviceDescriptor;
    this.maxRetries = maxRetries;
    this.retryCount = 0;
    this.device = null;
    this.adapter = null;
    this.epoch = 0;
    this.state = 'idle';
    this.reason = null;
    this.closed = false;
    this.pending = null;
    this.serial = 0;
    this.listeners = new Set(onStateChange ? [onStateChange] : []);
    this.rebuilders = new Map();
    this.pipelineCaches = pipelineCaches();
    this.retirement = new RetirementQueue({onError: error => this.notify('gpu-error', error.message)});
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  addRebuilder(key, callback) {
    if (this.rebuilders.has(key)) throw new Error('GPU rebuilder already registered');
    this.rebuilders.set(key, callback);
    return () => this.rebuilders.delete(key);
  }

  notify(state, reason = null) {
    this.state = state;
    this.reason = reason;
    const event = {state, reason, device: this.device, adapter: this.adapter, epoch: this.epoch};
    for (const callback of this.listeners) callback(event);
  }

  acquire() {
    if (this.closed) return Promise.reject(new Error('GPU device service is disposed'));
    if (this.device && this.state === 'ready') return Promise.resolve(this.device);
    if (this.pending) return this.pending;
    if (this.state === 'unavailable') return Promise.reject(new Error(this.reason));
    this.resetPipelineCaches();
    const epoch = ++this.epoch;
    this.pending = this.create(epoch).finally(() => {
      if (this.epoch === epoch) this.pending = null;
    });
    return this.pending;
  }

  async create(epoch) {
    this.notify('acquiring');
    try {
      const adapter = await this.gpu?.requestAdapter(this.adapterOptions);
      if (!adapter) throw new Error('WebGPU adapter is unavailable');
      const device = await adapter.requestDevice(this.deviceDescriptor);
      if (this.closed || epoch !== this.epoch) {
        device.destroy();
        throw new Error('GPU acquisition was cancelled');
      }
      this.adapter = adapter;
      this.device = device;
      for (const rebuild of this.rebuilders.values()) await rebuild({device, adapter, epoch});
      if (this.closed || epoch !== this.epoch) {
        device.destroy();
        throw new Error('GPU rebuilding was cancelled');
      }
      device.lost.then(info => this.lost(device, epoch, info), error => this.lost(device, epoch, {message: error.message}));
      this.notify('ready');
      return device;
    } catch (error) {
      if (!this.closed && epoch === this.epoch) {
        this.device?.destroy();
        this.device = null;
        this.notify('unavailable', error.message);
      }
      throw error;
    }
  }

  lost(device, epoch, info) {
    if (this.closed || epoch !== this.epoch || device !== this.device) return;
    this.device = null;
    this.pending = null;
    this.resetPipelineCaches();
    this.notify('lost', info.message || info.reason || 'GPU device lost');
    if (this.retryCount++ >= this.maxRetries) {
      this.notify('unavailable', 'GPU recovery retry limit exceeded');
      return;
    }
    this.acquire().catch(error => {
      if (!this.closed) this.notify('unavailable', error.message);
    });
  }

  submit(commandBuffers) {
    if (this.closed || this.state !== 'ready') throw new Error('GPU device is not ready');
    this.device.queue.submit(commandBuffers);
    return Object.freeze({id: ++this.serial, done: this.device.queue.onSubmittedWorkDone()});
  }

  resetPipelineCaches() {
    for (const cache of Object.values(this.pipelineCaches)) cache.clear();
    this.pipelineCaches = pipelineCaches();
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.epoch++;
    const device = this.device;
    this.device = null;
    this.notify('disposed');
    this.listeners.clear();
    this.rebuilders.clear();
    this.resetPipelineCaches();
    await this.retirement.dispose();
    device?.destroy();
  }
}
