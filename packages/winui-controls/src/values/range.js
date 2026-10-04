import { ControlEvents, ControlError } from '../policy/events.js';

export class NumericRange extends ControlEvents {
  constructor({ minimum = 0, maximum = 100, value = 0, smallChange = 1, largeChange = 10, wrap = false } = {}) {
    super();
    this.minimum = minimum;
    this.maximum = maximum;
    this.smallChange = smallChange;
    this.largeChange = largeChange;
    this.wrap = wrap;
    this.value = Number.NaN;
    this.validate();
    this.set(value);
  }
  validate() {
    if (typeof this.minimum !== 'number' || typeof this.maximum !== 'number'
      || Number.isNaN(this.minimum) || Number.isNaN(this.maximum) || this.minimum > this.maximum) {
      throw new ControlError('SFUI1680', 'The minimum must not exceed the maximum');
    }
    if (!Number.isFinite(this.smallChange) || !Number.isFinite(this.largeChange) || !(this.smallChange > 0) || !(this.largeChange > 0)) {
      throw new ControlError('SFUI1681', 'Range increments must be finite and positive');
    }
  }
  set(value) {
    if (typeof value !== 'number') throw new ControlError('SFUI1682', 'A numeric range value is required');
    const next = Number.isNaN(value) ? value : Math.max(this.minimum, Math.min(this.maximum, value));
    if (Object.is(next, this.value)) return false;
    const previous = this.value;
    this.value = next;
    this.emit('ValueChanged', { OldValue: previous, NewValue: next });
    return true;
  }
  step(direction, large = false) {
    let next = (Number.isNaN(this.value) ? Math.max(this.minimum, Math.min(this.maximum, 0)) : this.value)
      + direction * (large ? this.largeChange : this.smallChange);
    if (this.wrap && Number.isFinite(this.minimum) && Number.isFinite(this.maximum)) {
      if (next > this.maximum) next = this.minimum;
      else if (next < this.minimum) next = this.maximum;
    }
    this.set(next);
  }
  get fraction() { return this.maximum === this.minimum ? 0 : (this.value - this.minimum) / (this.maximum - this.minimum); }
  snapshot() { return { version: 1, minimum: this.minimum, maximum: this.maximum, value: this.value,
    smallChange: this.smallChange, largeChange: this.largeChange, wrap: this.wrap }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1682', 'Invalid range snapshot');
    Object.assign(this, { minimum: snapshot.minimum, maximum: snapshot.maximum, value: snapshot.value,
      smallChange: snapshot.smallChange, largeChange: snapshot.largeChange, wrap: snapshot.wrap });
    this.validate();
  }
}

/** Locale-specific decimal/group separators and digits are normalized before arithmetic parsing. */
export class CultureNumberFormatter {
  constructor(locale = 'en-US', options = {}) {
    this.formatter = new Intl.NumberFormat(locale, options);
    const parts = this.formatter.formatToParts(12345.6);
    this.group = parts.find(part => part.type === 'group')?.value ?? ',';
    this.decimal = parts.find(part => part.type === 'decimal')?.value ?? '.';
    this.digits = new Map(Array.from({ length: 10 }, (_, digit) => [new Intl.NumberFormat(locale,
      { useGrouping: false }).format(digit), String(digit)]));
  }
  format(value) { return Number.isNaN(value) ? '' : this.formatter.format(value); }
  normalize(text) {
    let value = '';
    for (const character of String(text)) {
      if (character === this.group || /[\s\u200e\u200f\u061c]/u.test(character)) continue;
      value += character === this.decimal ? '.' : this.digits.get(character) ?? character;
    }
    return value;
  }
  parse(text) {
    const value = this.normalize(text);
    if (!value) return Number.NaN;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new ControlError('SFUI1683', 'Invalid number text');
    const result = Number(value);
    if (!Number.isFinite(result)) throw new ControlError('SFUI1683', 'Number text is outside the finite range');
    return result;
  }
}
