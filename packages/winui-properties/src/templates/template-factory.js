import {NameScope} from './name-scope.js';
import {DisposableScope} from '../object-model/disposable-scope.js';
import {ResourceFault} from '../resources/errors.js';
import {ValueSource} from '../property/property-store.js';
import {withUIConstruction} from '../object-model/construction-roots.js';

/** Runtime adapters provide creation/parenting; templates own every subscription created for an instance. */
export class TemplateContext {
  constructor({owner = null, data = undefined, resources = null, parentNamescope = null, adapter = {}, signal = null} = {}) {
    this.owner = owner;
    this.data = data;
    this.resources = resources;
    this.adapter = adapter;
    this.signal = signal;
    this.namescope = new NameScope({owner, parent: parentNamescope});
    this.lifetime = new DisposableScope();
    this.lifetime.add(this.namescope);
    this.root = null;
    this.nodes = [];
  }

  register(name, element) {
    this.signal?.throwIfAborted();
    this.namescope.registerName(name, element);
    return element;
  }

  own(disposable) { return this.lifetime.add(disposable); }
  findName(name) { return this.namescope.findName(name); }

  /** TemplateBinding forwards effective parent values into the dedicated templated-parent source slot. */
  bind(target, targetProperty, sourceProperty, {convert = value => value} = {}) {
    const source = this.adapter.storeFor?.(this.owner);
    const destination = this.adapter.storeFor?.(target);
    if (!source || !destination) throw new ResourceFault('SFTPL005', 'TemplateBinding requires parent and target property stores.');
    const update = value => destination.setSource(targetProperty, ValueSource.TemplatedParent, convert(value));
    update(source.getValue(sourceProperty));
    const listener = change => update(change.newValue);
    let unsubscribe = source.subscribe(sourceProperty, listener);
    this.own({
      snapshot: () => ({active: unsubscribe !== null}),
      restore(snapshot) {
        unsubscribe?.();
        unsubscribe = snapshot.active ? source.subscribe(sourceProperty, listener) : null;
      },
      dispose({preserveValues = false} = {}) {
        unsubscribe?.();
        unsubscribe = null;
        if (!preserveValues) destination.clearSource(targetProperty, ValueSource.TemplatedParent);
      }
    });
  }
}

export class TemplateInstance {
  constructor(root, context, nodes) {
    this.root = root;
    this.context = context;
    this.namescope = context.namescope;
    this.nodes = nodes;
    this.disposed = false;
  }

  getTemplateChild(name) { return this.disposed ? null : this.namescope.findName(name); }

  snapshot() {
    return {root: this.root, nodes: [...this.nodes], disposed: this.disposed,
      owner: this.context.owner, data: this.context.data, lifetime: this.context.lifetime.snapshot(), namescope: this.namescope.snapshot()};
  }

  restore(snapshot) {
    this.root = snapshot.root;
    this.nodes = [...snapshot.nodes];
    this.disposed = snapshot.disposed;
    this.context.owner = snapshot.owner;
    this.context.data = snapshot.data;
    this.context.root = snapshot.root;
    this.context.nodes = this.nodes;
    this.namescope.restore(snapshot.namescope);
    this.context.lifetime.restore(snapshot.lifetime);
  }

  *retainedValues() { yield this.context.owner; yield this.context.data; yield* this.nodes; }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    this.disposed = true;
    const failures = [];
    try { this.context.lifetime.dispose({preserveValues, templateDisposal: true}); } catch (error) { failures.push(error); }
    for (let index = preserveValues ? -1 : this.nodes.length - 1; index >= 0; index--) {
      const node = this.nodes[index];
      for (const cleanup of [() => this.context.adapter.setTemplatedParent?.(node, null, null),
        () => this.context.adapter.detach?.(node), () => this.context.adapter.dispose?.(node)]) {
        try { cleanup(); } catch (error) { failures.push(error); }
      }
    }
    this.nodes.length = 0;
    this.root = null;
    this.context.root = null;
    this.context.owner = null;
    this.context.data = undefined;
    if (failures.length) throw new AggregateError(failures, 'Template instance disposal failed.');
  }
}

/** Factories construct fresh visuals; immutable template definitions may be shared by any number of controls. */
export class FrameworkTemplate {
  constructor(factory, {maxNodes = 100000, maxDepth = 512, validate = null, allowEmpty = factory === undefined} = {}) {
    if (factory === undefined) factory = () => null;
    if (typeof factory !== 'function') throw new TypeError('A template factory function is required.');
    this.factory = factory;
    this.maxNodes = maxNodes;
    this.maxDepth = maxDepth;
    this.validate = validate;
    this.allowEmpty = allowEmpty;
    this.created = new WeakSet();
  }

  instantiate(options = {}) {
    const context = options instanceof TemplateContext ? options : new TemplateContext(options);
    return withUIConstruction(context.adapter, () => this.instantiateContext(context), [context.owner, context.data]);
  }

  instantiateContext(context) {
    context.signal?.throwIfAborted();
    let nodes = context.nodes;
    try {
      const root = this.factory(context);
      if (root === null && this.allowEmpty) return new TemplateInstance(null, context, []);
      if (!root || typeof root !== 'object' || root.then) throw new ResourceFault('SFTPL006', 'Template factory must return one visual synchronously.');
      context.root = root;
      nodes = this.inspect(root, context);
      this.validate?.(root, context);
      for (const node of nodes) {
        this.created.add(node);
        context.adapter.setTemplatedParent?.(node, context.owner, context.namescope);
      }
      context.adapter.setDataContext?.(root, context.data, {inherited: true});
      return new TemplateInstance(root, context, nodes);
    } catch (error) {
      const failures = [error];
      try { context.lifetime.dispose(); } catch (failure) { failures.push(failure); }
      for (let index = nodes.length - 1; index >= 0; index--) {
        try { context.adapter.dispose?.(nodes[index]); } catch (failure) { failures.push(failure); }
      }
      if (failures.length > 1) throw new AggregateError(failures, 'Template creation and cleanup failed.', {cause: error});
      throw error;
    }
  }

  inspect(root, context) {
    const nodes = context.nodes;
    const seen = new Set();
    const queue = [[root, 0]];
    const children = context.adapter.children ?? (node => node.children ?? []);
    while (queue.length) {
      context.signal?.throwIfAborted();
      const [node, depth] = queue.pop();
      if (seen.has(node) || this.created.has(node)) throw new ResourceFault('SFTPL007', 'Template factories cannot share mutable visuals.');
      if (nodes.length >= this.maxNodes || depth > this.maxDepth) throw new ResourceFault('SFTPL008', 'Template tree budget exceeded.');
      seen.add(node);
      nodes.push(node);
      const name = context.adapter.name?.(node) ?? node.name ?? node.Name;
      if (name && context.namescope.peekName(name) !== node) context.register(name, node);
      const nested = context.adapter.isTemplateBoundary?.(node);
      if (!nested) for (const child of children(node)) queue.push([child, depth + 1]);
    }
    return nodes;
  }

  loadContent(options = {}) { return this.instantiate(options); }

  snapshot() {
    return {factory: this.factory, maxNodes: this.maxNodes, maxDepth: this.maxDepth, validate: this.validate, allowEmpty: this.allowEmpty,
      targetType: this.targetType, dataType: this.dataType};
  }

  /** Restoring a definition never materializes content or forgets previously issued visual identities. */
  restore(snapshot) {
    this.factory = snapshot.factory;
    this.maxNodes = snapshot.maxNodes;
    this.maxDepth = snapshot.maxDepth;
    this.validate = snapshot.validate;
    this.allowEmpty = snapshot.allowEmpty;
    if ('targetType' in this) this.targetType = snapshot.targetType;
    if ('dataType' in this) this.dataType = snapshot.dataType;
  }

  *retainedValues() {
    if (this.factory.retainedValues) yield* this.factory.retainedValues();
  }
}

export class ControlTemplate extends FrameworkTemplate {
  constructor(factory, {targetType = null, ...options} = {}) {
    super(factory, options);
    this.targetType = targetType;
  }
}

export class DataTemplate extends FrameworkTemplate {
  constructor(factory, options = {}) {
    super(factory, options);
    this.dataType = options.dataType ?? null;
  }
}

export class ItemsPanelTemplate extends FrameworkTemplate {}

export class DataTemplateSelector {
  constructor() { this.reconstructible = true; }
  selectTemplate(item, container) { return this.selectTemplateCore(item, container); }
  selectTemplateCore() { return null; }
}
