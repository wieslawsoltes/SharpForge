import {types, contracts, propertiesFor, eventsFor, frameworkType, colorValues, XAML} from '@sharpforge/framework';
import {adopt, release} from './collections.js';
import {colorChannels} from './values.js';
import {invokeFacadeMethod} from './methods.js';
import {subscribeFacadeEvent, removeFacadeEvent} from './event-subscriptions.js';

function addNamespace(context, path, value) {
  const parts = path.split('.');
  let target = context.namespaces;
  for (const name of parts.slice(0, -1)) target = target[name] ??= {};
  target[parts.at(-1)] = value;
}

function construct(context, type, definition, args) {
  const descriptor = {owner: type, kind: 'constructor', name: '.ctor', isStatic: true};
  const extension = context.invoke(descriptor, null, args);
  if (extension.handled) return extension.value;
  if (definition.kind === 'value' || definition.kind === 'brush') return context.values.create(type, args);
  if (['abstract', 'static', 'interface'].includes(definition.kind)) throw new TypeError(type + ' is not constructible');
  const values = {};
  if (type === XAML + 'Setter' && args.length) { values.Property = args[0]; values.Value = args[1]; }
  if (type === XAML + 'Style' && args.length) values.TargetTypeName = args[0];
  return context.allocate(type, values);
}

export function createFacadeTypes(context) {
  for (const [type, definition] of types) {
    if (definition.kind === 'enum') { addNamespace(context, type, Object.freeze({...definition.values})); continue; }
    const system = type.startsWith('System.') && !['System.TimeSpan', 'System.DateTime', 'System.DateTimeOffset'].includes(type)
      && !type.startsWith('System.Numerics.') && !type.startsWith('System.ComponentModel.')
      && !type.startsWith('System.Collections.ObjectModel.') && !type.startsWith('System.Collections.Specialized.');
    if (system || type.startsWith('SharpForge.Runtime.') || ['delegate', 'task', 'thread'].includes(definition.kind)) continue;
    const Type = class { constructor(...args) {
      const object = construct(context, type, definition, args);
      if (new.target !== Type && object?.$node) Object.setPrototypeOf(object, new.target.prototype);
      return object;
    } };
    Object.defineProperty(Type, 'name', {value: type.split('.').at(-1)});
    Object.defineProperty(Type, '$type', {value: type});
    context.classes.set(type, Type);
    if (definition.kind !== 'collection' || type.startsWith('System.Collections.ObjectModel.')) addNamespace(context, type, Type);
  }
  for (const [type, Type] of context.classes) {
    const base = context.classes.get(frameworkType(type)?.base);
    if (base) Object.setPrototypeOf(Type.prototype, base.prototype);
  }
}

function staticProperty(context, type, property) {
  if (type === 'Microsoft.UI.Colors') return context.values.create('Windows.UI.Color', colorChannels(colorValues[property]));
  if (type === 'System.TimeSpan' && property === 'Zero') return context.values.create(type, [0]);
  if (property === 'Automatic' || property === 'Forever') return Object.freeze({valueType: type, kind: property === 'Forever' ? 'forever' : 'auto'});
  if (property === 'UnsetValue') return context.styles.unset;
  if (property.endsWith('Property')) return context.styles.dp(type, property.slice(0, -8));
  if (property === 'Current') return context.application;
  if (property === 'Auto') return context.values.create(XAML + 'GridLength', [1, 0]);
  return null;
}

function installProperty(context, type, Type, name, property) {
  const descriptor = {owner: type, property: name, result: property.type, isStatic: property.isStatic};
  Object.defineProperty(property.isStatic ? Type : Type.prototype, name, {
    get() {
      const result = context.invoke({...descriptor, kind: 'get', name: 'get_' + name}, property.isStatic ? null : this, []);
      if (result.handled) return result.value;
      if (property.isStatic) return staticProperty(context, type, name);
      return context.read(this, name);
    },
    set: property.readOnly ? undefined : function(value) {
      const result = context.invoke({...descriptor, kind: 'set', name: 'set_' + name}, property.isStatic ? null : this, [value]);
      if (result.handled) return;
      context.styles.validate(this, name, value);
      if ((name === 'Content' || name === 'Child') && value !== this.$values[name]) {
        adopt(context, this, value);
        release(context, this, this.$values[name]);
      }
      context.styles.set(this, name, value);
    }
  });
}

function installEvent(context, type, Type, name) {
  Object.defineProperty(Type.prototype, name, {get() {
    return {add: handler => this['add_' + name](handler), remove: handler => this['remove_' + name](handler)};
  }});
  Type.prototype['add_' + name] = function(handler) {
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    const result = context.invoke({owner: type, kind: 'eventAdd', name: 'add_' + name, event: name}, this, [handler]);
    if (result.handled) return result.value;
    subscribeFacadeEvent(context, this, name, handler);
  };
  Type.prototype['remove_' + name] = function(handler) {
    const result = context.invoke({owner: type, kind: 'eventRemove', name: 'remove_' + name, event: name}, this, [handler]);
    if (result.handled) return result.value;
    removeFacadeEvent(context, this, name, handler);
  };
}

export function installFacadeMembers(context) {
  for (const [type, Type] of context.classes) {
    for (const [name, property] of Object.entries(propertiesFor(type))) installProperty(context, type, Type, name, property);
    for (const name of Object.keys(eventsFor(type))) installEvent(context, type, Type, name);
  }
  const groups = new Map();
  for (const descriptor of contracts) {
    const Type = context.classes.get(descriptor.owner);
    if (!Type || ['get', 'set', 'constructor', 'eventAdd', 'eventRemove'].includes(descriptor.kind)) continue;
    const key = descriptor.owner + '::' + descriptor.name;
    const group = groups.get(key) ?? [];
    group.push(descriptor);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const Type = context.classes.get(first.owner);
    const target = first.isStatic ? Type : Type.prototype;
    if (Object.hasOwn(target, first.name)) continue;
    target[first.name] = function(...args) {
      const descriptor = group.find(member => member.parameters.length === args.length) ?? first;
      return invokeFacadeMethod(context, this, descriptor, args);
    };
  }
}
