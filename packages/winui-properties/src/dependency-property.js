import {PropertyFault} from './property/values.js';
import {normalizePropertyMetadata} from './property/metadata.js';
import {defaultPropertyValue, validatePropertyValue} from './property/validation.js';
export {PropertyFault, UnsetValue} from './property/values.js';

const identity = value => value;

/** Session-owned identities; framework descriptors may be supplied lazily. */
export class DependencyPropertyRegistry {
  constructor({canonicalType = identity, baseType = () => null, isAssignable, getDeclaredProperty, validate, ...services} = {}) {
    this.canonicalType = canonicalType;
    this.baseType = baseType;
    this.isAssignable = isAssignable ?? ((target, source) => this.baseAssignable(target, source));
    this.getDeclaredProperty = getDeclaredProperty ?? (() => null);
    this.services = services;
    this.validate = validate ?? ((property, value) => validatePropertyValue(property, value, {
      ...services, registry: this, isAssignable: this.isAssignable
    }));
    this.owners = new Map();
    this.identities = new Map();
    this.nextId = 1;
    this.maxProperties = services.maxProperties ?? 100000;
    if (!Number.isSafeInteger(this.maxProperties) || this.maxProperties < 1 || this.maxProperties > 1000000) {
      throw new RangeError('Property registry capacity must be between one and one million');
    }
    this.snapshotOwner = Object.freeze({});
    this.knownTokens = new WeakSet();
  }

  baseAssignable(target, source) {
    target = this.canonicalType(target);
    source = this.canonicalType(source);
    if (target === 'object') return true;
    const seen = new Set();
    while (source && !seen.has(source)) {
      if (target === source) return true;
      if (seen.size >= 256) throw new PropertyFault('InvalidOperationException', 'Property assignability depth exceeded');
      seen.add(source);
      source = this.canonicalType(this.baseType(source));
    }
    return false;
  }

  /** Register exactly once per declaring owner/name; duplicate registration faults. */
  register({name, ownerType, propertyType = 'object', metadata = {}, attached = false, readOnly = false}) {
    const owner = this.canonicalType(ownerType);
    const type = this.canonicalType(propertyType);
    if (typeof name !== 'string' || !name.length || name.length > 512 || typeof owner !== 'string' || !owner.length
      || owner.length > 4096 || typeof type !== 'string' || !type.length || type.length > 4096) {
      throw new PropertyFault('ArgumentException', 'A property requires a name, owner and property type');
    }
    metadata = normalizePropertyMetadata(metadata);
    if (metadata.defaultValue === undefined) {
      const value = metadata.enumValues ? 0 : defaultPropertyValue(type, this.services.typeDefinition?.(type));
      metadata = {...metadata, defaultValue: value};
    }
    const existing = this.owners.get(owner);
    if (existing?.has(name)) {
      throw new PropertyFault('ArgumentException', `Dependency property '${name}' is already registered`);
    }
    if (this.identities.size >= this.maxProperties || this.nextId >= Number.MAX_SAFE_INTEGER) {
      throw new PropertyFault('InvalidOperationException', 'Property registry size or identity limit exceeded');
    }
    const definition = Object.freeze({
      id: this.nextId,
      kind: 'DependencyProperty',
      owner,
      ownerType: owner,
      name,
      Name: name,
      propertyType: type,
      type,
      metadata: Object.freeze({...metadata}),
      attached: !!attached,
      readOnly: !!readOnly
    });
    this.validate(definition, metadata.defaultValue, {registration: true});
    this.nextId++;
    const properties = existing ?? new Map();
    properties.set(name, definition);
    if (!existing) this.owners.set(owner, properties);
    this.identities.set(definition.id, definition);
    this.knownTokens.add(definition);
    return definition;
  }

  /** Register an attached property usable on any dependency object. */
  registerAttached(options) {
    return this.register({...options, attached: true});
  }

  /** Resolve an inherited property to its declaring-owner identity in O(base depth). */
  lookup(ownerType, name) {
    let owner = this.canonicalType(ownerType);
    const seen = new Set();
    while (owner && !seen.has(owner)) {
      seen.add(owner);
      if (seen.size > 256) throw new PropertyFault('InvalidOperationException', 'Property owner depth exceeded');
      const registered = this.owners.get(owner)?.get(name);
      if (registered) return registered;
      const descriptor = this.getDeclaredProperty(owner, name);
      if (descriptor && !descriptor.isStatic) {
        if (descriptor.metadata?.aliasOwner) { owner = this.canonicalType(descriptor.metadata.aliasOwner); continue; }
        return this.register({
          ownerType: owner,
          name,
          propertyType: descriptor.type,
          readOnly: descriptor.readOnly,
          attached: descriptor.attached,
          metadata: {
            defaultValue: descriptor.value ?? defaultPropertyValue(descriptor.type, this.services.typeDefinition?.(descriptor.type)),
            ...descriptor.metadata
          }
        });
      }
      owner = this.baseType(owner);
    }
    return null;
  }

  /** Reject forged and cross-registry tokens, even if their numeric IDs match. */
  resolve(token) {
    if (!token || this.identities.get(token.id) !== token) {
      throw new PropertyFault('ArgumentException', 'A registered dependency property identity is required');
    }
    return token;
  }

  /** Check owner applicability without weakening attached-property identity. */
  applicable(token, ownerType) {
    const property = this.resolve(token);
    return property.attached || this.isAssignable(property.ownerType, this.canonicalType(ownerType));
  }

  /** Enumerate already registered applicable properties, including attached ones. */
  propertiesFor(ownerType) {
    return [...this.identities.values()].filter(property => this.applicable(property, ownerType));
  }

  /** In-memory snapshot retains immutable token identities, including managed metadata values. */
  snapshot() {
    return {version: 1, owner: this.snapshotOwner, nextId: this.nextId, properties: [...this.identities.values()]};
  }

  /** Restore removes post-snapshot registrations while preserving previously captured tokens. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.owner !== this.snapshotOwner || !Array.isArray(snapshot.properties)) {
      throw new PropertyFault('ArgumentException', 'Invalid property registry snapshot');
    }
    if (snapshot.properties.length > this.maxProperties || !Number.isSafeInteger(snapshot.nextId) || snapshot.nextId < 1) {
      throw new PropertyFault('ArgumentException', 'Property registry snapshot limit exceeded');
    }
    const owners = new Map();
    const identities = new Map();
    for (const property of snapshot.properties) {
      if (!this.knownTokens.has(property) || !Object.isFrozen(property) || identities.has(property.id) || property.id >= snapshot.nextId) {
        throw new PropertyFault('ArgumentException', 'Invalid property identity in snapshot');
      }
      const properties = owners.get(property.ownerType) ?? new Map();
      if (properties.has(property.name)) throw new PropertyFault('ArgumentException', 'Duplicate snapshot property');
      properties.set(property.name, property);
      owners.set(property.ownerType, properties);
      identities.set(property.id, property);
    }
    this.owners = owners;
    this.identities = identities;
    this.nextId = snapshot.nextId;
  }

  /** Registration-owned managed callbacks/defaults stay alive with this session. */
  *retainedValues() {
    for (const property of this.identities.values()) {
      yield property.metadata.defaultValue;
      yield property.metadata.propertyChangedCallback;
      yield property.metadata.createDefaultValueCallback;
      yield property.metadata.validateValueCallback;
      yield property.metadata.coerceValueCallback;
    }
  }
}
