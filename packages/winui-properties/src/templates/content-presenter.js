import {DataTemplate} from './template-factory.js';
import {ResourceFault} from '../resources/errors.js';

/** Content adaptation is explicit: data template, UIElement or an implicit TextBlock. */
export class ContentPresenterController {
  constructor({presenter, adapter, resources = null, owner = null, parentNamescope = null}) {
    this.presenter = presenter;
    this.adapter = adapter;
    this.resources = resources;
    this.owner = owner;
    this.parentNamescope = parentNamescope;
    this.current = null;
    this.content = undefined;
    this.template = null;
    this.disposed = false;
  }

  present(content, {template = null, selector = null, signal = null} = {}) {
    if (this.disposed) throw new ResourceFault('SFTPL012', 'The content presenter is disposed.');
    signal?.throwIfAborted();
    const selected = template ?? selector?.selectTemplate(content, this.presenter) ?? null;
    if ((this.content === content || this.adapter.same?.(this.content, content)) && this.template === selected) return this.current?.root ?? null;
    if (selected && !(selected instanceof DataTemplate)) throw new ResourceFault('SFTPL013', 'ContentTemplate must be a DataTemplate.');
    let next = null;
    if (selected) {
      next = selected.instantiate({owner: this.owner, data: content, resources: this.resources,
        parentNamescope: this.parentNamescope, adapter: this.adapter, signal});
    } else if (content !== null && content !== undefined) next = this.adapt(content);
    try {
      this.adapter.attachRoot?.(this.presenter, next?.root ?? null, this.current?.root ?? null);
    } catch (error) {
      try { next?.dispose(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Content attachment and cleanup failed.', {cause: error}); }
      throw error;
    }
    const previous = this.current;
    this.current = next;
    this.content = content;
    this.template = selected;
    previous?.dispose();
    return next?.root ?? null;
  }

  adapt(content) {
    const visual = this.adapter.isVisual?.(content) ?? false;
    const root = visual ? content : this.adapter.createText(this.adapter.formatContent?.(content) ?? String(content));
    const parent = this.adapter.parent?.(root);
    if (parent && parent !== this.presenter && !this.adapter.same?.(parent, this.presenter)) {
      if (!visual) this.adapter.dispose?.(root);
      throw new ResourceFault('SFTPL014', 'UIElement content already has a parent.');
    }
    this.adapter.setDataContext?.(root, content, {inherited: true});
    const adapter = this.adapter;
    return {root, disposed: false,
      snapshot() { return {disposed: this.disposed}; },
      restore(snapshot) { this.disposed = snapshot.disposed; },
      *retainedValues() { yield root; },
      dispose({preserveValues = false} = {}) {
        if (this.disposed) return;
        this.disposed = true;
        if (preserveValues) return;
        adapter.detach?.(root);
        if (!visual) adapter.dispose?.(root);
      }};
  }

  presentFromOwner() {
    if (!this.owner || !this.adapter.read) throw new ResourceFault('SFTPL015', 'Templated parent content access is unavailable.');
    return this.present(this.adapter.read(this.owner, 'Content'), {
      template: this.adapter.read(this.owner, 'ContentTemplate'),
      selector: this.adapter.read(this.owner, 'ContentTemplateSelector')
    });
  }

  snapshot() {
    return {presenter: this.presenter, resources: this.resources, owner: this.owner, parentNamescope: this.parentNamescope,
      current: this.current, currentState: this.current?.snapshot?.(), content: this.content, template: this.template, disposed: this.disposed};
  }

  restore(snapshot) {
    if (this.current !== snapshot.current) this.current?.dispose({preserveValues: true, clear: false});
    for (const name of ['presenter', 'resources', 'owner', 'parentNamescope', 'current', 'content', 'template', 'disposed']) {
      this[name] = snapshot[name];
    }
    if (snapshot.currentState) this.current.restore(snapshot.currentState);
  }

  *retainedValues() {
    yield this.presenter;
    yield this.owner;
    yield this.content;
    yield this.current?.root;
    if (this.current?.retainedValues) yield* this.current.retainedValues();
    if (this.template?.retainedValues) yield* this.template.retainedValues();
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    this.disposed = true;
    const failures = [];
    if (!preserveValues) {
      try { this.adapter.attachRoot?.(this.presenter, null, this.current?.root ?? null); } catch (error) { failures.push(error); }
    }
    try { this.current?.dispose({preserveValues}); } catch (error) { failures.push(error); }
    this.current = null;
    this.content = undefined;
    this.template = null;
    this.owner = null;
    this.presenter = null;
    this.resources = null;
    if (failures.length) throw new AggregateError(failures, 'Content presenter disposal failed.');
  }
}
