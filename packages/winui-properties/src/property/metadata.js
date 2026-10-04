import {PropertyFault} from './values.js';

/** Immutable dependency-property metadata; factory defaults are evaluated per owner. */
export class PropertyMetadata {
  constructor(defaultValue = null, propertyChangedCallback = null, options = {}) {
    this.defaultValue = defaultValue;
    this.propertyChangedCallback = propertyChangedCallback;
    this.createDefaultValueCallback = options.createDefaultValueCallback ?? null;
    this.validateValueCallback = options.validateValueCallback ?? null;
    this.coerceValueCallback = options.coerceValueCallback ?? null;
    this.inherits = !!options.inherits;
    this.inheritanceKey = options.inheritanceKey ?? null;
    this.defaultUpdateSourceTrigger = options.defaultUpdateSourceTrigger ?? 'PropertyChanged';
    this.twoWayByDefault = !!options.twoWayByDefault;
    this.allowNaN = !!options.allowNaN;
    this.allowInfinity = !!options.allowInfinity;
    this.minimum = options.minimum;
    this.maximum = options.maximum;
    this.enumValues = options.enumValues;
    this.flags = !!options.flags;
    this.structFields = options.structFields;
    Object.freeze(this);
  }

  get reconstructible() { return true; }
}

/** Normalize managed metadata spellings without mutating the caller's object. */
export function normalizePropertyMetadata(metadata = {}) {
  if (metadata === null || typeof metadata !== 'object') {
    throw new PropertyFault('ArgumentException', 'Property metadata must be an object');
  }
  return Object.freeze({
    ...metadata,
    defaultValue: Object.hasOwn(metadata, 'DefaultValue') ? metadata.DefaultValue : metadata.defaultValue,
    propertyChangedCallback: metadata.PropertyChangedCallback ?? metadata.propertyChangedCallback ?? null,
    createDefaultValueCallback: metadata.CreateDefaultValueCallback ?? metadata.createDefaultValueCallback ?? null,
    validateValueCallback: metadata.ValidateValueCallback ?? metadata.validateValueCallback ?? null,
    coerceValueCallback: metadata.CoerceValueCallback ?? metadata.coerceValueCallback ?? null,
    inherits: !!metadata.inherits
  });
}
