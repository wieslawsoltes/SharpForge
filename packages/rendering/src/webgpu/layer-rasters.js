import {LayerCache} from '../layer-cache.js';
import {describeLayerRaster, hasBackdropDependency} from '../layer-raster-key.js';

/** Cached local layer plans share GPU pools while owning their viewport uniform and deferred lifetime. */
export class GpuLayerRasters {
  constructor(backend, {maxBytes = 64 * 1024 * 1024} = {}) {
    this.backend = backend;
    this.cache = new LayerCache({maxBytes});
    this.subscriptions = new Map();
    this.closed = false;
  }
  acquire(layer, resources, options, createPlan) {
    if (this.closed) throw new Error('GPU layer cache is disposed');
    if (hasBackdropDependency(layer.displayList.commands, resources)) return null;
    const description = describeLayerRaster(layer, resources, options);
    if (!description) return null;
    if (resources?.subscribe && !this.subscriptions.has(resources)) {
      this.subscriptions.set(resources, resources.subscribe(event => this.cache.invalidateResource(event.handle)));
    }
    let entry = this.cache.get(description.key, description.version);
    if (entry) return entry;
    const backend = this.backend;
    const facade = Object.create(backend);
    facade.pixelWidth = description.width;
    facade.pixelHeight = description.height;
    facade.uniformData = new Float32Array([description.bounds[2], description.bounds[3], backend.colorSpace === 'linear' ? 1 : 0, 0]);
    facade.uniform = backend.device.createBuffer({label: 'SharpForge cached layer viewport', size: 16, usage: 64 | 8});
    backend.device.queue.writeBuffer(facade.uniform, 0, facade.uniformData);
    facade.effects = Object.create(backend.effects);
    facade.effects.backend = facade;
    let plan;
    try {
      plan = createPlan(facade, description.list, resources, {...options, width: description.bounds[2], height: description.bounds[3]});
      const program = facade.effects.layer(plan.root.image, layer, plan, description);
      facade.plan = plan;
      entry = {plan, program, image: program?.output ?? plan.root.image, description, facade,
        references: 0, cached: false, rendered: false, ticket: null, closed: false};
      const bytes = plan.buffers.reduce((sum, lease) => sum + lease.size, 16)
        + plan.targets.reduce((sum, target) => sum + target.image.size + (target.multisample === target.image ? 0 : target.multisample.size)
          + target.depth.size, 0) + plan.effectTextures.reduce((sum, lease) => sum + lease.size, 0);
      if (bytes <= this.cache.maxBytes) {
        entry.cached = true;
        this.cache.getOrCreate(description.key, {version: description.version, bytes, resources: description.handles,
          create: () => entry, destroy: value => { value.cached = false; this.retire(value); }});
      }
      return entry;
    } catch (error) {
      plan?.dispose();
      backend.service.retirement.retire(facade.uniform);
      throw error;
    }
  }
  pin(plan, entry) {
    if (plan.cachedLayers.has(entry)) return;
    plan.cachedLayers.add(entry);
    entry.references++;
  }
  submitted(entry, ticket) {
    entry.ticket = ticket;
    entry.plan.markSubmitted(ticket);
    this.backend.service.retirement.use(entry.facade.uniform, ticket);
  }
  release(entry) { entry.references--; this.retire(entry); }
  retire(entry) {
    if (entry.closed || entry.cached || entry.references) return;
    entry.closed = true;
    entry.plan.dispose();
    this.backend.service.retirement.retire(entry.facade.uniform);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.cache.dispose();
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }
}
