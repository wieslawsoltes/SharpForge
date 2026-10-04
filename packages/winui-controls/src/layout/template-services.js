const annotatedType = 'Microsoft.UI.Xaml.Controls.AnnotatedScrollBar';
const modelKey = 'layout.templates';

function supports(context, owner) {
  const type = context.typeOf(owner);
  return type === annotatedType || context.propertyRegistry?.isAssignable(annotatedType, type) === true;
}
function same(context, left, right) {
  if (left === right) return true;
  return left && right && context.typeOf(left) && context.typeOf(right) && context.id(left) === context.id(right);
}
function templateModel(context, owner, name) {
  const reference = context.read(owner, name);
  if (!reference) return null;
  const model = context.unwrapModel(reference);
  if (!model?.instantiate) throw new TypeError('SFTPL013: Annotated content templates must be registered DataTemplate objects');
  return model;
}

/** Auxiliary control content uses the same managed item generator, template bindings and recycling lifetimes as ItemsControl. */
class LayoutTemplateState {
  constructor(service, owner) {
    this.service = service;
    this.owner = owner;
    const schedule = service.context.scheduleUI;
    this.labels = service.createGenerator({ owner, schedule, maxItems: 2048, maxPool: 32 });
    this.detail = service.createGenerator({ owner, schedule, maxItems: 1, maxPool: 1 });
    this.labelTemplate = null;
    this.labelItems = [];
    this.detailItem = undefined;
    this.detailTemplate = null;
    this.preparing = false;
    this.disposed = false;
  }
  updateLabels() {
    if (this.preparing || this.disposed) return;
    this.preparing = true;
    const { context } = this.service;
    try {
      const template = templateModel(context, this.owner, 'LabelTemplate');
      const collection = context.read(this.owner, 'Labels');
      const labels = collection == null ? [] : context.items(collection);
      if (labels.length > 2048) throw new RangeError('SFUI1677: Annotated template label limit');
      const items = template ? labels.map(label => context.read(label, 'Content')) : [];
      if (this.labelTemplate === template && items.length === this.labelItems.length
        && items.every((item, index) => same(context, item, this.labelItems[index]))) return;
      this.labels.template = template;
      this.labels.setItems(items);
      this.labelTemplate = template;
      this.labelItems = items;
      for (let index = 0; index < items.length; index++) this.labels.realize(index);
      this.publish();
    } finally { this.preparing = false; }
  }
  updateDetail(content) {
    if (this.disposed) throw new Error('SFUI1677: Annotated template owner has been disposed');
    const { context } = this.service;
    const template = templateModel(context, this.owner, 'DetailLabelTemplate');
    if (!same(context, content, this.detailItem) || template !== this.detailTemplate) {
      this.detail.template = template;
      this.detail.setItems(content == null ? [] : [content]);
      this.detailItem = content;
      this.detailTemplate = template;
      if (content != null) this.detail.realize(0);
      this.publish();
    }
    return this.detail.containerFromIndex(0);
  }
  scene() {
    const { context } = this.service;
    const reference = value => value == null ? null : { $ref: context.id(value) };
    return { version: 1,
      labels: this.labelItems.map((_, index) => reference(this.labels.containerFromIndex(index))),
      detail: reference(this.detail.containerFromIndex(0)) };
  }
  publish() {
    const { context } = this.service;
    const containers = [...this.labels.byIndex.values(), ...this.detail.byIndex.values()].map(entry => entry.container);
    if (containers.length > 2049) throw new RangeError('SFUI1677: Annotated template realization limit');
    context.publishItemContainers(this.owner, containers);
    context.syncOwner?.(this.owner);
    this.service.publish(this.owner, this.scene());
  }
  snapshot() {
    return { labels: this.labels.snapshot(), detail: this.detail.snapshot(), labelItems: [...this.labelItems],
      labelTemplate: this.labelTemplate, detailItem: this.detailItem, detailTemplate: this.detailTemplate, disposed: this.disposed };
  }
  restore(snapshot) {
    this.labels.restore(snapshot.labels);
    this.detail.restore(snapshot.detail);
    for (const name of ['labelItems', 'labelTemplate', 'detailItem', 'detailTemplate', 'disposed']) this[name] = snapshot[name];
    this.preparing = false;
  }
  *retainedValues() {
    yield this.owner;
    yield* this.labels.retainedValues();
    yield* this.detail.retainedValues();
  }
  dispose(options) {
    if (this.disposed) return;
    this.disposed = true;
    const failures = [];
    for (const generator of [this.labels, this.detail]) {
      try { generator.dispose(options); } catch (error) { failures.push(error); }
    }
    this.labelItems = [];
    this.detailItem = undefined;
    if (failures.length) throw new AggregateError(failures, 'Annotated template disposal failed');
  }
}

/** Install after initializeItemsContext. createGenerator injects ItemContainerGenerator without a package dependency cycle. */
export function createLayoutTemplateServices(context, { createGenerator, publish } = {}) {
  if (typeof createGenerator !== 'function') throw new TypeError('Layout templates require the shared item generator factory');
  const service = { context, createGenerator,
    publish: publish ?? ((owner, value) => {
      const command = { op: 'set', id: context.id(owner), property: '$layoutTemplates', value };
      if (context.send) context.send(command);
      else context.platform.command(command);
    }),
    prepare(owner) {
      if (!supports(context, owner)) return false;
      const previous = context.state(owner, modelKey);
      if (!previous && !context.read(owner, 'LabelTemplate')) return false;
      context.state(owner, modelKey, () => new LayoutTemplateState(service, owner)).updateLabels();
      return true;
    },
    changed(change) {
      const property = change.property.name;
      if (['LabelTemplate', 'Labels'].includes(property)) return service.prepare(change.owner);
      if (property === 'DetailLabelTemplate' && supports(context, change.owner)) {
        const model = context.state(change.owner, modelKey);
        if (model?.detailItem != null) model.updateDetail(model.detailItem);
      }
      return false;
    },
    collectionChanged(owner, property) { return property === 'Labels' ? service.prepare(owner) : false; },
    prepareDetail(owner, outcome) {
      if (!supports(context, owner)) return outcome;
      const model = context.state(owner, modelKey, () => new LayoutTemplateState(service, owner));
      model.updateLabels();
      const content = outcome.Content?.$ref ? context.reference(outcome.Content.$ref) : outcome.Content;
      outcome.Content = model.updateDetail(content);
      return outcome;
    },
    scene(owner) { return supports(context, owner) ? context.state(owner, modelKey)?.scene() ?? null : null; }
  };
  return service;
}
