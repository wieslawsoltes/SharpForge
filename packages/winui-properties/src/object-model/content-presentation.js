import {ContentPresenterController} from '../templates/content-presenter.js';
import {resourceScopeModel} from './resource-adapter-models.js';
import {selectorModel} from './selector-model.js';
import {ResourceFault} from '../resources/errors.js';

const presenterType = 'Microsoft.UI.Xaml.Controls.ContentPresenter';
const contentProperties = new Set(['Content', 'ContentTemplate', 'ContentTemplateSelector']);

function same(context, left, right) {
  return left === right || left && right && context.isVisual(left) && context.isVisual(right) && context.id(left) === context.id(right);
}

function presentationAdapter(context, presenter) {
  return {...context.templateHostAdapter,
    same: (left, right) => same(context, left, right),
    attachRoot: (owner, root, previous) => {
      const parent = root && context.parentOf(root);
      const templatedOwner = context.read(presenter, '$templateOwner');
      if (parent && !same(context, parent, presenter) && same(context, parent, templatedOwner)) {
        context.setVisualParent(root, null);
      }
      return context.templateHostAdapter.attachRoot(owner, root, previous);
    },
    parent: value => {
      const parent = context.parentOf(value);
      const owner = context.read(presenter, '$templateOwner');
      return parent && same(context, parent, owner) ? presenter : parent;
    },
    formatContent: value => String(context.native(value)),
    createText: text => {
      const element = context.make('Microsoft.UI.Xaml.Controls.TextBlock');
      context.write(element, 'Text', text);
      return element;
    }
  };
}

function updatePresentation(context, presenter) {
  if (context.isAlive && !context.isAlive(presenter)) return;
  const controller = context.state(presenter, 'contentPresenter', () => new ContentPresenterController({presenter,
    adapter: presentationAdapter(context, presenter), resources: resourceScopeModel(context, presenter)}));
  controller.owner = context.read(presenter, '$templateOwner') ?? presenter;
  controller.parentNamescope = context.unwrapModel(context.read(presenter, '$nameScope')) ?? null;
  try {
    return controller.present(context.read(presenter, 'Content'), {
      template: context.unwrapModel(context.read(presenter, 'ContentTemplate')),
      selector: selectorModel(context, context.read(presenter, 'ContentTemplateSelector'))
    });
  } finally { context.syncOwner?.(presenter); }
}

/** A snapshot-capable work queue coalesces three related properties until their namescope and parent exist. */
class ContentPresentationQueue {
  constructor(context, {maxPending = 100000, maxUpdates = 4096} = {}) {
    this.context = context;
    this.maxPending = maxPending;
    this.maxUpdates = maxUpdates;
    this.pending = new Map();
    this.scheduled = false;
    this.flushing = false;
    this.disposed = false;
    this.callback = () => this.flush();
  }

  add(owner) {
    if (this.disposed) return;
    const id = this.context.id(owner);
    if (!this.pending.has(id) && this.pending.size >= this.maxPending) throw new ResourceFault('SFTPL018', 'Content queue budget exceeded.');
    this.pending.set(id, owner);
    if (!this.scheduled && !this.flushing && this.context.scheduleUI) {
      this.scheduled = true;
      try { this.context.scheduleUI(this.callback); }
      catch (error) { this.scheduled = false; throw error; }
    }
  }

  flush() {
    if (this.flushing || this.disposed) return 0;
    this.scheduled = false;
    this.flushing = true;
    let completed = 0;
    try {
      while (this.pending.size) {
        if (completed >= this.maxUpdates) throw new ResourceFault('SFTPL018', 'Content-template update recursion budget exceeded.');
        const [id, owner] = this.pending.entries().next().value;
        this.pending.delete(id);
        const operation = () => updatePresentation(this.context, owner);
        if (this.context.sceneTransaction) this.context.sceneTransaction(operation);
        else operation();
        completed++;
      }
    } finally { this.flushing = false; }
    return completed;
  }

  snapshot() { return {pending: [...this.pending], scheduled: this.scheduled, disposed: this.disposed}; }
  restore(snapshot) {
    this.pending = new Map(snapshot.pending);
    this.scheduled = snapshot.scheduled;
    this.disposed = snapshot.disposed;
    this.flushing = false;
  }
  *retainedValues() { yield* this.pending.values(); }
  dispose() { this.pending.clear(); this.disposed = true; this.scheduled = false; }
}

/** Hosts call presentationChanged from their property fanout and flush before layout or scene publication. */
export function initializeContentPresentation(context, options) {
  const queue = context.state(null, 'contentPresentationQueue', () => new ContentPresentationQueue(context, options));
  context.presentationChanged = change => {
    if (!contentProperties.has(change.property.name) ||
      !context.propertyRegistry.isAssignable(presenterType, context.typeOf(change.owner))) return;
    queue.add(change.owner);
  };
  context.flushContentPresenters = () => queue.flush();
  return queue;
}
