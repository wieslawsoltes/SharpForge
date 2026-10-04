import {UnsetValue} from '../property/values.js';

export const BindingMode = Object.freeze({OneTime: 0, OneWay: 1, TwoWay: 2});
export const UpdateSourceTrigger = Object.freeze({Default: 0, PropertyChanged: 1, Explicit: 2, LostFocus: 3});
export const RelativeSourceMode = Object.freeze({None: 0, TemplatedParent: 1, Self: 2});

export class BindingBase {}

/** Host-independent Binding configuration; unset source/fallback differ from null. */
export class Binding extends BindingBase {
  constructor(options = {}) {
    super();
    this.Path = '';
    this.Source = UnsetValue;
    this.ElementName = null;
    this.RelativeSource = null;
    this.Mode = BindingMode.OneWay;
    this.Converter = null;
    this.ConverterParameter = null;
    this.ConverterLanguage = '';
    this.FallbackValue = UnsetValue;
    this.TargetNullValue = UnsetValue;
    this.UpdateSourceTrigger = UpdateSourceTrigger.Default;
    Object.assign(this, options);
  }

  *retainedValues() {
    yield this.Source;
    yield this.Converter;
    yield this.ConverterParameter;
    yield this.FallbackValue;
    yield this.TargetNullValue;
  }

  snapshot() { return {version: 1, values: {...this}}; }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !snapshot.values || typeof snapshot.values !== 'object') throw new TypeError('Invalid Binding snapshot');
    Object.assign(this, snapshot.values);
  }
}

export class RelativeSource {
  constructor(mode = RelativeSourceMode.TemplatedParent) { this.Mode = mode; }
  snapshot() { return {version: 1, Mode: this.Mode}; }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Object.values(RelativeSourceMode).includes(snapshot.Mode)) throw new TypeError('Invalid RelativeSource snapshot');
    this.Mode = snapshot.Mode;
  }
}

export function normalizeBindingMode(mode, metadata = {}) {
  if (mode === undefined || mode === null) return 'OneWay';
  if (typeof mode === 'number') mode = Object.keys(BindingMode).find(name => BindingMode[name] === mode);
  if (mode === 'Default') mode = metadata.twoWayByDefault ? 'TwoWay' : 'OneWay';
  if (!['OneTime', 'OneWay', 'TwoWay'].includes(mode)) throw new TypeError('Unknown binding mode');
  return mode;
}

export function normalizeUpdateSourceTrigger(trigger, metadata = {}) {
  if (typeof trigger === 'number') trigger = Object.keys(UpdateSourceTrigger).find(name => UpdateSourceTrigger[name] === trigger);
  if (!trigger || trigger === 'Default') trigger = metadata.defaultUpdateSourceTrigger ?? 'PropertyChanged';
  if (!['PropertyChanged', 'LostFocus', 'Explicit'].includes(trigger)) throw new TypeError('Unknown update source trigger');
  return trigger;
}
