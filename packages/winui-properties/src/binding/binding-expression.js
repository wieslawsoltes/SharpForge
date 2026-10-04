import {UnsetValue} from '../property/values.js';
import {ValueSource} from '../property/property-store.js';
import {Binding, normalizeBindingMode, normalizeUpdateSourceTrigger, RelativeSourceMode} from './binding.js';
import {parsePropertyPath} from './property-path.js';
import {readPathStep, writePathStep, observePathStep} from './accessors.js';
import {BindingDiagnosticCode as Code, bindingDiagnostic} from './diagnostics.js';
import {convertBindingValue} from './type-converters.js';
import {propertyValuesEqual} from '../property/value-equality.js';

/** A live binding owns only its subscriptions and writes the Binding precedence slot. */
export class BindingExpression {
  constructor({store, property, binding = new Binding(), services = {}, source = ValueSource.Binding} = {}) {
    if (!(binding instanceof Binding)) binding = new Binding(binding);
    this.store = store;
    this.property = store.assertProperty(property, true);
    this.ParentBinding = binding;
    this.services = services;
    this.sourceSlot = source;
    this.mode = normalizeBindingMode(binding.Mode, property.metadata);
    this.updateSourceTrigger = normalizeUpdateSourceTrigger(binding.UpdateSourceTrigger, property.metadata);
    this.subscriptions = [];
    this.pathDependencies = [];
    this.contextSubscriptions = [];
    this.targetSubscription = null;
    this.sourceObject = UnsetValue;
    this.lastReceiver = UnsetValue;
    this.lastStep = null;
    this.pendingTarget = UnsetValue;
    this.transferredTarget = UnsetValue;
    this.writingTarget = false;
    this.writingSource = false;
    this.updating = false;
    this.pending = false;
    this.active = false;
    this.disposed = false;
    this.restoring = false;
    this.error = null;
    const weak = new WeakRef(this);
    this.sourceChanged = () => weak.deref()?.requestTransfer();
    this.targetChanged = change => weak.deref()?.targetValueChanged(change);
    try { this.steps = parsePropertyPath(binding.Path); }
    catch (error) {
      this.steps = null;
      this.report(Code.InvalidPath, error.message, error.position);
    }
  }

  /** Attach once; unload/load cycles safely detach and rebuild every path subscription. */
  attach() {
    if (this.disposed || this.active) return this;
    this.active = true;
    try {
      this.subscribeContext();
      if (this.mode === 'TwoWay') this.targetSubscription = this.store.subscribe(this.property, this.targetChanged);
    } catch (error) {
      this.report(Code.Lifetime, error.message);
      this.detach();
      return this;
    }
    this.requestTransfer();
    return this;
  }

  subscribeContext() {
    const binding = this.ParentBinding;
    if (binding.Source !== UnsetValue) return;
    if (binding.ElementName) {
      const dispose = this.services.subscribeNameScope?.(this.store.owner, this.sourceChanged, binding.ElementName);
      if (dispose) this.contextSubscriptions.push(dispose);
      return;
    }
    if (binding.RelativeSource) {
      const dispose = this.services.subscribeTemplatedParent?.(this.store.owner, this.sourceChanged);
      if (dispose) this.contextSubscriptions.push(dispose);
      return;
    }
    const dataContext = this.store.registry.lookup(this.store.ownerType, 'DataContext');
    if (dataContext) this.contextSubscriptions.push(this.store.subscribe(dataContext, this.sourceChanged));
    else {
      const dispose = this.services.subscribeDataContext?.(this.store.owner, this.sourceChanged);
      if (dispose) this.contextSubscriptions.push(dispose);
    }
  }

  resolveSource() {
    const binding = this.ParentBinding;
    if (binding.Source !== UnsetValue) return binding.Source;
    if (binding.ElementName) return this.services.findName?.(this.store.owner, binding.ElementName) ?? UnsetValue;
    if (binding.RelativeSource) {
      const mode = binding.RelativeSource.Mode ?? binding.RelativeSource.mode;
      if (mode === RelativeSourceMode.Self || mode === 'Self') return this.store.owner;
      if (mode === RelativeSourceMode.TemplatedParent || mode === 'TemplatedParent') {
        return this.services.templatedParent?.(this.store.owner) ?? UnsetValue;
      }
      return UnsetValue;
    }
    if (this.services.dataContext) return this.services.dataContext(this.store.owner);
    const dataContext = this.store.registry.lookup(this.store.ownerType, 'DataContext');
    return dataContext ? this.store.getValue(dataContext) : UnsetValue;
  }

  requestTransfer() {
    if (!this.active || this.disposed || this.writingSource || this.restoring) return;
    if (this.updating) { this.pending = true; return; }
    this.updating = true;
    let changes = 0;
    try {
      do {
        this.pending = false;
        if (++changes > (this.services.maxUpdates ?? 128)) {
          this.report(Code.Cycle, 'Binding did not converge within the update budget');
          this.detach();
          return;
        }
        this.transfer();
      } while (this.pending && this.active);
    } finally {
      this.updating = false;
      if (!this.restoring) this.services.stateChanged?.(this.store.owner);
    }
  }

  transfer() {
    this.clearPathSubscriptions();
    this.lastReceiver = UnsetValue;
    this.lastStep = null;
    let value = UnsetValue;
    if (this.steps) {
      try {
        this.sourceObject = this.resolveSource();
        value = this.evaluatePath(this.sourceObject);
      } catch (error) { this.report(Code.MissingMember, error.message); }
    }
    if (value === UnsetValue) {
      if (this.steps) this.report(Code.MissingSource, 'Binding source or path is unavailable');
    } else {
      if (value !== null || this.ParentBinding.Converter) value = this.convert(value, false);
      if (value === null && this.ParentBinding.TargetNullValue !== UnsetValue) value = this.convertSubstitute(this.ParentBinding.TargetNullValue);
      else if (value === null) value = this.convertSubstitute(null);
    }
    if (value === UnsetValue && this.ParentBinding.FallbackValue !== UnsetValue) value = this.convertSubstitute(this.ParentBinding.FallbackValue);
    this.writingTarget = true;
    try {
      if (value === UnsetValue) this.store.clearSource(this.property, this.sourceSlot);
      else this.store.setSource(this.property, this.sourceSlot, value);
      this.transferredTarget = this.store.getValue(this.property);
    } catch (error) {
      this.report(Code.ConversionFailure, error.message);
      this.store.clearSource(this.property, this.sourceSlot);
    } finally { this.writingTarget = false; }
  }

  convertSubstitute(value) {
    try {
      return this.services.convert ? this.services.convert(value, this.property.propertyType)
        : convertBindingValue(value, this.property.propertyType, this.services);
    } catch (error) {
      this.report(Code.ConversionFailure, error.message);
      return UnsetValue;
    }
  }

  evaluatePath(source) {
    let value = source;
    for (let index = 0; index < this.steps.length; index++) {
      const step = this.steps[index];
      if (value === null || value === undefined || value === UnsetValue) return UnsetValue;
      if (this.active && this.mode !== 'OneTime') {
        this.pathDependencies.push({receiver: value, step});
        this.subscriptions.push(observePathStep(value, step, this.sourceChanged, this.services));
      }
      this.lastReceiver = value;
      this.lastStep = step;
      value = readPathStep(value, step, this.services);
      if (value === UnsetValue) {
        this.report(step.kind === 'index' ? Code.InvalidIndex : Code.MissingMember, 'Binding path step is unavailable', index);
        return UnsetValue;
      }
    }
    return value;
  }

  convert(value, backward) {
    const binding = this.ParentBinding;
    const method = backward ? 'ConvertBack' : 'Convert';
    const targetType = backward ? this.services.sourcePropertyType?.(this.lastReceiver, this.lastStep) ?? 'object' : this.property.propertyType;
    try {
      if (binding.Converter) {
        const args = [value, targetType, binding.ConverterParameter, binding.ConverterLanguage];
        if (this.services.invokeConverter) {
          const valueType = backward ? this.property.propertyType : this.services.sourcePropertyType?.(this.lastReceiver, this.lastStep);
          return this.services.invokeConverter(binding.Converter, method, args, {valueType});
        }
        if (typeof binding.Converter[method] !== 'function') throw new TypeError(`Converter does not implement ${method}`);
        return binding.Converter[method](...args);
      }
      if (this.services.convert) return this.services.convert(value, targetType);
      return convertBindingValue(value, targetType, this.services);
    } catch (error) {
      this.report(binding.Converter ? Code.ConverterFailure : Code.ConversionFailure, error.message);
      return UnsetValue;
    }
  }

  targetValueChanged(change) {
    if (!this.active || this.writingTarget || this.restoring || this.mode !== 'TwoWay') return;
    if (propertyValuesEqual(change.newValue, this.transferredTarget)) return;
    this.transferredTarget = UnsetValue;
    this.pendingTarget = change.newValue;
    if (this.updateSourceTrigger === 'PropertyChanged') this.UpdateSource();
  }

  /** UI hosts call this for input without replacing the binding with a local value. */
  notifyTargetChanged(value, trigger = 'PropertyChanged') {
    if (this.disposed || this.mode !== 'TwoWay') return;
    this.pendingTarget = value;
    this.writingTarget = true;
    try { this.store.setSource(this.property, this.sourceSlot, value); }
    finally { this.writingTarget = false; }
    if (this.updateSourceTrigger === trigger) this.UpdateSource();
  }

  LostFocus() {
    if (this.updateSourceTrigger === 'LostFocus') this.UpdateSource();
  }

  /** Explicit TwoWay writeback; failures are diagnostics and never create missing sources. */
  UpdateSource() {
    if (this.disposed || this.mode !== 'TwoWay' || this.writingSource) return;
    let value = this.pendingTarget === UnsetValue ? this.store.getValue(this.property) : this.pendingTarget;
    value = this.convert(value, true);
    if (value === UnsetValue) return;
    if (!this.lastStep || this.lastReceiver === UnsetValue) {
      this.report(Code.SourceUpdateFailure, 'A writable source path is required');
      return;
    }
    this.writingSource = true;
    try {
      writePathStep(this.lastReceiver, this.lastStep, value, this.services);
      this.pendingTarget = UnsetValue;
    } catch (error) { this.report(Code.SourceUpdateFailure, error.message); }
    finally { this.writingSource = false; }
    this.requestTransfer();
  }

  UpdateTarget() {
    if (!this.disposed) this.transfer();
  }

  clearPathSubscriptions() {
    const subscriptions = this.subscriptions;
    this.subscriptions = [];
    this.pathDependencies = [];
    this.releaseSubscriptions(subscriptions);
  }

  detach() {
    this.active = false;
    const subscriptions = [...this.subscriptions, ...this.contextSubscriptions];
    if (this.targetSubscription) subscriptions.push(this.targetSubscription);
    this.subscriptions = [];
    this.pathDependencies = [];
    this.contextSubscriptions = [];
    this.targetSubscription = null;
    this.sourceObject = UnsetValue;
    this.lastReceiver = UnsetValue;
    this.lastStep = null;
    this.releaseSubscriptions(subscriptions);
  }

  releaseSubscriptions(subscriptions) {
    for (const dispose of subscriptions) {
      try { dispose(); } catch (error) { this.report(Code.Lifetime, error.message); }
    }
  }

  report(code, message, step = null) {
    const path = typeof this.ParentBinding?.Path === 'string' ? this.ParentBinding.Path : this.ParentBinding?.Path?.Path ?? '';
    const privateMessages = {
      [Code.ConverterFailure]: 'Value converter failed', [Code.ConversionFailure]: 'Binding value could not be converted to the target type',
      [Code.SourceUpdateFailure]: 'Binding source rejected the update', [Code.MissingMember]: 'Binding source member is unavailable',
      [Code.Lifetime]: 'Binding subscription could not be released'
    };
    message = privateMessages[code] ?? message;
    if (/password|secret|token/i.test(path + this.property.name)) message = 'Sensitive binding failed; values are redacted';
    let sourceType;
    try { sourceType = this.services.typeOf?.(this.sourceObject); } catch { sourceType = null; }
    sourceType ??= this.sourceObject?.$node?.type ?? this.sourceObject?.valueType ?? typeof this.sourceObject;
    this.error = bindingDiagnostic(code, {path, step, sourceType, targetProperty: this.property.name, message});
    try { this.services.diagnostics?.(this.error); } catch { /* Binding diagnostics never interrupt source or target execution. */ }
  }

  dispose({clear = true} = {}) {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    if (clear && !this.store.disposed) this.store.clearSource(this.property, this.sourceSlot);
    this.ParentBinding = null;
    this.services = {};
  }

  *retainedValues() {
    if (this.ParentBinding) yield* this.ParentBinding.retainedValues();
    yield this.pendingTarget;
  }

  snapshot() {
    return {version: 1, binding: this.ParentBinding, bindingState: this.ParentBinding?.snapshot(),
      source: this.sourceSlot, active: this.active, disposed: this.disposed, pendingTarget: this.pendingTarget,
      transferredTarget: this.transferredTarget,
      sourceObject: this.sourceObject, lastReceiver: this.lastReceiver, lastStep: this.lastStep,
      dependencies: [...this.pathDependencies], services: this.services, steps: this.steps, error: this.error,
      mode: this.mode, updateSourceTrigger: this.updateSourceTrigger};
  }

  restore(snapshot, services = snapshot?.services) {
    if (snapshot?.version !== 1 || !snapshot.disposed && !(snapshot.binding instanceof Binding)
      || !Array.isArray(snapshot.dependencies) || snapshot.dependencies.length > 128
      || snapshot.steps !== null && (!Array.isArray(snapshot.steps) || snapshot.steps.length > 128)) {
      throw new TypeError('Invalid BindingExpression snapshot');
    }
    services?.beginRestore?.();
    try { this.restoreState(snapshot, services); }
    finally { this.restoring = false; services?.endRestore?.(); }
  }

  restoreState(snapshot, services) {
    this.restoring = true;
    this.detach();
    this.services = services;
    this.ParentBinding = snapshot.binding;
    this.sourceSlot = snapshot.source;
    this.disposed = snapshot.disposed;
    if (this.disposed) { this.restoring = false; return; }
    this.ParentBinding.restore(snapshot.bindingState);
    this.pendingTarget = snapshot.pendingTarget;
    this.transferredTarget = Object.hasOwn(snapshot, 'transferredTarget') ? snapshot.transferredTarget : UnsetValue;
    this.mode = snapshot.mode;
    this.updateSourceTrigger = snapshot.updateSourceTrigger;
    this.steps = snapshot.steps;
    this.error = snapshot.error;
    this.sourceObject = snapshot.sourceObject;
    this.lastReceiver = snapshot.lastReceiver;
    this.lastStep = snapshot.lastStep;
    if (!snapshot.active) { this.restoring = false; return; }
    try {
      this.active = true;
      this.subscribeContext();
      for (const dependency of snapshot.dependencies) {
        this.pathDependencies.push(dependency);
        this.subscriptions.push(observePathStep(dependency.receiver, dependency.step, this.sourceChanged, this.services));
      }
      if (this.mode === 'TwoWay') this.targetSubscription = this.store.subscribe(this.property, this.targetChanged);
    } finally { this.restoring = false; }
  }
}
