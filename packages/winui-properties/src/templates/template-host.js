import {ControlTemplate} from './template-factory.js';
import {ResourceFault} from '../resources/errors.js';

/** A control's replaceable template. Old handlers are detached before OnApplyTemplate sees the new tree. */
export class TemplateHost {
  constructor({owner, adapter = {}, registry = null, resources = null, parentNamescope = null, onApplyTemplate = null}) {
    this.owner = owner;
    this.adapter = adapter;
    this.registry = registry;
    this.resources = resources;
    this.parentNamescope = parentNamescope;
    this.onApplyTemplate = onApplyTemplate;
    this.template = null;
    this.instance = null;
    this.initialized = false;
    this.disposed = false;
  }

  apply(template, {signal = null, force = false} = {}) {
    if (this.disposed) throw new ResourceFault('SFTPL009', 'Template host is disposed.');
    if (this.template === template && !force) { this.initialized = true; return false; }
    if (template !== null && !(template instanceof ControlTemplate)) throw new ResourceFault('SFTPL010', 'A ControlTemplate is required.');
    const ownerType = this.adapter.typeOf?.(this.owner);
    if (template?.targetType && !this.registry?.isAssignable(template.targetType, ownerType)) {
      throw new ResourceFault('SFTPL011', 'ControlTemplate.TargetType is incompatible with this control.');
    }
    const next = template?.instantiate({owner: this.owner, resources: this.resources,
      parentNamescope: this.parentNamescope, adapter: this.adapter, signal}) ?? null;
    const previous = this.instance;
    try {
      this.adapter.attachRoot?.(this.owner, next?.root ?? null, previous?.root ?? null);
    } catch (error) {
      next?.dispose();
      throw error;
    }
    this.instance = next;
    this.template = template;
    this.initialized = true;
    previous?.dispose();
    if (next?.root) this.onApplyTemplate?.(this.owner, next);
    return Boolean(next?.root);
  }

  getTemplateChild(name) { return this.instance?.getTemplateChild(name) ?? null; }
  get namescope() { return this.instance?.namescope ?? null; }

  snapshot() {
    return {owner: this.owner, template: this.template, instance: this.instance,
      instanceState: this.instance?.snapshot(), initialized: this.initialized, disposed: this.disposed, resources: this.resources,
      parentNamescope: this.parentNamescope, onApplyTemplate: this.onApplyTemplate};
  }

  /** Restored heap/store state already contains the visual tree; no factory or OnApplyTemplate is replayed. */
  restore(snapshot) {
    if (this.instance && this.instance !== snapshot.instance) {
      this.instance.context.lifetime.dispose({preserveValues: true, clear: false});
    }
    this.owner = snapshot.owner;
    this.template = snapshot.template;
    this.instance = snapshot.instance;
    this.initialized = snapshot.initialized ?? Boolean(snapshot.instance);
    this.disposed = snapshot.disposed;
    this.resources = snapshot.resources;
    this.parentNamescope = snapshot.parentNamescope;
    this.onApplyTemplate = snapshot.onApplyTemplate;
    this.instance?.restore(snapshot.instanceState);
  }

  *retainedValues() {
    yield this.owner;
    if (this.template?.retainedValues) yield* this.template.retainedValues();
    if (this.instance) yield* this.instance.retainedValues();
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    if (preserveValues) this.instance?.dispose({preserveValues});
    else this.apply(null);
    this.instance = null;
    this.template = null;
    this.disposed = true;
    this.owner = null;
    this.resources = null;
    this.parentNamescope = null;
    this.onApplyTemplate = null;
  }
}

export const templatePartContracts = Object.freeze({
  Button: Object.freeze({parts: ['ContentPresenter'], groups: ['CommonStates', 'FocusStates']}),
  ToggleButton: Object.freeze({parts: ['ContentPresenter'], groups: ['CommonStates', 'FocusStates', 'CheckStates']}),
  TextBox: Object.freeze({parts: ['ContentElement', 'HeaderContentPresenter', 'PlaceholderTextContentPresenter'],
    groups: ['CommonStates', 'FocusStates']}),
  ListView: Object.freeze({parts: ['ScrollViewer', 'ItemsPresenter'], groups: ['CommonStates', 'FocusStates']}),
  ComboBox: Object.freeze({parts: ['Popup', 'ContentPresenter', 'ItemsPresenter'], groups: ['CommonStates', 'FocusStates']})
});
