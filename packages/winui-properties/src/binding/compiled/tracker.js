import {PropertyFault, UnsetValue} from '../../property/values.js';
import {propertyValuesEqual} from '../../property/value-equality.js';
import {evaluateCompiledExpression, writeCompiledPath, assertCompiledType} from './evaluate.js';

export function disposeSubscriptions(disposers) {
  const errors = [];
  for (const dispose of disposers) { try { dispose(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, 'Compiled binding subscription disposal failed');
}

/** One token expression owns an indexed set of receivers and no hidden application roots. */
export class CompiledExpressionTracker {
  constructor(descriptor, controller) {
    this.descriptor = descriptor;
    this.controller = controller;
    this.sourceSubscriptions = [];
    this.targetSubscription = null;
    this.dependencies = new Map();
    this.sourceObject = null;
    this.targetObject = null;
    this.initialized = false;
    this.updating = false;
    this.pending = false;
    this.writingTarget = false;
    this.writingSource = false;
    this.transferredTarget = UnsetValue;
    const weak = new WeakRef(this);
    this.changed = () => weak.deref()?.update();
    this.targetChanged = value => weak.deref()?.writeBack(value);
    this.eventChanged = (sender, eventArgs) => {
      const tracker = weak.deref();
      if (tracker?.controller.tracking && !tracker.controller.restoring) {
        evaluateCompiledExpression(tracker.descriptor.expression, tracker.context({sender, eventArgs, observe: null}));
      }
    };
  }

  context(extra = {}) {
    this.sourceObject = this.controller.source();
    assertCompiledType(this.sourceObject, this.descriptor.sourceType, this.controller.services);
    return {...this.controller.contextValues, source: this.sourceObject, services: this.controller.services,
      observe: (receiver, token) => this.observe(receiver, token), ...extra};
  }

  target() {
    this.targetObject = this.controller.target(this.descriptor.target.id);
    if (!this.targetObject) throw new PropertyFault('InvalidOperationException', 'Compiled binding target is unavailable');
    assertCompiledType(this.targetObject, this.descriptor.targetType, this.controller.services);
    return this.targetObject;
  }

  observe(receiver, token) {
    if (!this.controller.tracking || (this.descriptor.mode ?? 'OneTime') === 'OneTime') return;
    const services = this.controller.services;
    const identity = services.identity?.(receiver) ?? receiver;
    let dependency = this.dependencies.get(identity);
    if (!dependency) {
      dependency = {receiver, tokens: new Set()};
      this.dependencies.set(identity, dependency);
    }
    if (dependency.tokens.has(token)) return;
    dependency.tokens.add(token);
    const dispose = services.subscribe?.(receiver, token, this.changed);
    if (dispose) this.sourceSubscriptions.push(dispose);
  }

  attachTarget(target) {
    const services = this.controller.services;
    if (this.descriptor.kind === 'event') {
      if (!services.subscribeEvent) throw new PropertyFault('NotSupportedException', 'Compiled event adapter is unavailable');
      this.targetSubscription = services.subscribeEvent(target, this.descriptor.target.token, this.eventChanged);
    } else if (this.descriptor.mode === 'TwoWay') {
      if (!services.targetSubscribe) throw new PropertyFault('NotSupportedException', 'TwoWay compiled target notifications are unavailable');
      this.targetSubscription = services.targetSubscribe(target, this.descriptor.target.token, this.targetChanged);
    }
  }

  initialize() {
    if (!this.controller.tracking || this.controller.disposed) return;
    this.initialized = true;
    this.attachTarget(this.target());
    if (this.descriptor.kind !== 'event') this.update();
  }

  update() {
    if (this.controller.disposed || this.controller.restoring || this.writingSource || this.descriptor.kind === 'event') return;
    if (this.updating) { this.pending = true; return; }
    this.updating = true;
    let updates = 0;
    try {
      do {
        this.pending = false;
        if (++updates > this.controller.maxUpdates) throw new PropertyFault('InvalidOperationException', 'Compiled binding cycle exceeded');
        this.clearSources();
        const context = this.context();
        let value = evaluateCompiledExpression(this.descriptor.expression, context);
        if (this.descriptor.converter) value = evaluateCompiledExpression(this.descriptor.converter, {...context, value});
        if (value !== UnsetValue) this.transfer(value);
      } while (this.pending);
    } finally {
      this.updating = false;
      if (!this.controller.restoring) this.controller.services?.stateChanged?.();
    }
  }

  transfer(value) {
    const {services} = this.controller;
    const descriptor = this.descriptor;
    const target = this.target();
    if (descriptor.kind === 'load') {
      if (typeof value !== 'boolean') throw new PropertyFault('InvalidCastException', 'x:Load requires a Boolean expression');
      if (!services.setLoad) throw new PropertyFault('NotSupportedException', 'Deferred element adapter is unavailable');
      services.setLoad(target, descriptor.target.name, value);
      return;
    }
    if (!services.targetSet) throw new PropertyFault('NotSupportedException', 'Compiled property target writes are unavailable');
    this.transferredTarget = value;
    this.writingTarget = true;
    try {
      services.targetSet(target, descriptor.target.token, value);
      if (descriptor.mode === 'TwoWay' && services.targetGet) this.transferredTarget = services.targetGet(target, descriptor.target.token);
    }
    finally { this.writingTarget = false; }
  }

  writeBack(change) {
    let value = change && Object.hasOwn(change, 'newValue') ? change.newValue : change;
    if (this.writingTarget) { this.transferredTarget = value; return; }
    if (!this.controller.tracking || this.controller.restoring || this.writingSource || this.descriptor.mode !== 'TwoWay') return;
    if (propertyValuesEqual(value, this.transferredTarget)) return;
    this.transferredTarget = UnsetValue;
    this.writingSource = true;
    try {
      let context = this.context({value, observe: null});
      if (this.descriptor.convertBack) {
        value = evaluateCompiledExpression(this.descriptor.convertBack, context);
        if (value === UnsetValue) return;
        context = {...context, value};
      }
      if (this.descriptor.bindBack) evaluateCompiledExpression(this.descriptor.bindBack, context);
      else writeCompiledPath(this.descriptor.expression, value, context);
    } finally { this.writingSource = false; }
    this.update();
  }

  clearSources() {
    const disposers = this.sourceSubscriptions;
    this.sourceSubscriptions = [];
    this.dependencies.clear();
    disposeSubscriptions(disposers);
  }

  stop() {
    const disposers = [...this.sourceSubscriptions];
    if (this.targetSubscription) disposers.push(this.targetSubscription);
    this.sourceSubscriptions = [];
    this.targetSubscription = null;
    this.dependencies.clear();
    this.initialized = false;
    disposeSubscriptions(disposers);
  }

  *retainedValues() {
    yield this.sourceObject;
    yield this.targetObject;
    for (const dependency of this.dependencies.values()) yield dependency.receiver;
  }

  snapshot() {
    return {initialized: this.initialized, source: this.sourceObject, target: this.targetObject,
      transferredTarget: this.transferredTarget,
      dependencies: [...this.dependencies.values()].map(entry => ({receiver: entry.receiver, tokens: [...entry.tokens]}))};
  }

  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.dependencies) || snapshot.dependencies.length > 4096
      || snapshot.dependencies.some(entry => !Array.isArray(entry.tokens) || entry.tokens.length > 4096)) {
      throw new TypeError('Invalid compiled tracker snapshot');
    }
    this.stop();
    this.initialized = snapshot.initialized;
    this.sourceObject = snapshot.source;
    this.targetObject = snapshot.target;
    this.transferredTarget = Object.hasOwn(snapshot, 'transferredTarget') ? snapshot.transferredTarget : UnsetValue;
    if (!this.controller.tracking) return;
    for (const entry of snapshot.dependencies) for (const token of entry.tokens) this.observe(entry.receiver, token);
    if (this.initialized) this.attachTarget(this.targetObject);
  }
}
