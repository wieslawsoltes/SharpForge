import {XAML_NAMESPACE} from './xml-reader.js';
import {parseMarkupExtension} from './markup-extensions.js';
import {xamlFault} from './diagnostics.js';

/** Syntax slots survive unloading; their values and subscriptions are restored without rebuilding visuals. */
class XamlChildSlots {
  constructor(writer, parent, property, context, key) {
    this.writer = writer; this.parent = parent; this.property = property; this.context = context; this.key = key;
    this.slots = [];
  }

  reserve(node) {
    const metadata = this.writer.schema.metadata.get(this.parent);
    if (!this.property.collection && (this.slots.length || metadata.values.has(this.key))) {
      throw xamlFault('SFXAML057', 'Content property was assigned more than once.', node);
    }
    const slot = {value: null, attached: false};
    this.slots.push(slot);
    if (!this.property.collection) metadata.values.set(this.key, null);
    return slot;
  }

  position(slot) {
    let position = 0;
    for (const current of this.slots) {
      if (current === slot) return position;
      if (current.attached) position++;
    }
    throw xamlFault('SFXAML063', 'The deferred insertion slot is no longer owned by this tree.');
  }

  attach(slot, value) {
    if (slot.attached) throw xamlFault('SFXAML063', 'The deferred insertion slot is already occupied.');
    const {property, parent, context, key} = this;
    const metadata = this.writer.schema.metadata.get(parent);
    if (property.collection) {
      const index = this.position(slot);
      const values = key === '$content' ? metadata.children : metadata.values.get(key) ?? [];
      if (index === values.length) property.add(parent, value, context);
      else if (property.insert) property.insert(parent, index, value, context);
      else throw xamlFault('SFXAML063', 'Deferred collection insertion requires a registered Insert adapter.');
      values.splice(index, 0, value);
      if (key !== '$content') metadata.values.set(key, values);
    } else this.writer.assignDictionary(parent, property, value, context, key);
    slot.value = value; slot.attached = true;
  }

  detach(slot, value) {
    if (!slot.attached || slot.value !== value) return;
    const {property, parent, context, key} = this;
    const metadata = this.writer.schema.metadata.get(parent);
    if (property.collection) {
      if (!property.remove) throw xamlFault('SFXAML063', 'Deferred collection removal requires a registered RemoveAt adapter.');
      const index = this.position(slot);
      property.remove(parent, index, context);
      (key === '$content' ? metadata.children : metadata.values.get(key)).splice(index, 1);
    } else this.writer.assign(parent, property, null, context, key);
    slot.value = null; slot.attached = false;
  }

  snapshot() { return this.slots.map(slot => ({slot, value: slot.value, attached: slot.attached})); }
  restore(snapshot) {
    this.slots = snapshot.map(saved => {
      saved.slot.value = saved.value; saved.slot.attached = saved.attached;
      return saved.slot;
    });
    const metadata = this.writer.schema.metadata.get(this.parent);
    const values = this.slots.filter(slot => slot.attached).map(slot => slot.value);
    if (this.key === '$content') metadata.children = values;
    else metadata.values.set(this.key, this.property.collection ? values : values[0] ?? null);
  }
  *retainedValues() { yield this.parent; for (const slot of this.slots) if (slot.attached) yield slot.value; }
  dispose() { this.slots.length = 0; }
}

export function appendXamlNode(writer, node, parent, property, context, key) {
  const metadata = writer.schema.metadata.get(parent);
  metadata.slots ??= new Map();
  let slots = metadata.slots.get(key);
  if (!slots) {
    slots = new XamlChildSlots(writer, parent, property, context, key);
    metadata.slots.set(key, slots);
    context.lifetime.add(slots);
  }
  const slot = slots.reserve(node);
  const directive = node.attributes.find(attribute => attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Load');
  if (!directive || context.deferredActivation === node) {
    const value = writer.build(node, context);
    if (value !== null) slots.attach(slot, value);
    return;
  }
  if (!writer.services.deferElement) throw xamlFault('SFXAML062', 'x:Load requires a registered deferred-element adapter.', directive);
  if (property.collection && (!property.insert || !property.remove)) {
    throw xamlFault('SFXAML063', 'x:Load requires ordered collection insertion and removal adapters.', directive);
  }
  let load = parseMarkupExtension(directive.value, {span: directive.span});
  if (typeof load === 'string' && /^(true|false)$/i.test(load)) load = load.toLowerCase() === 'true';
  const parts = load?.kind === 'MarkupExtension' ? load.name.split(':') : [];
  const compiled = parts.length === 2 && parts[1] === 'Bind' && node.namespaces.get(parts[0]) === XAML_NAMESPACE;
  if (typeof load !== 'boolean' && !compiled) {
    throw xamlFault('SFXAML062', 'x:Load accepts a Boolean literal or a compiled x:Bind expression.', directive);
  }
  const name = node.attributes.find(attribute => attribute.namespace === XAML_NAMESPACE && attribute.localName === 'Name')?.value ??
    node.attributes.find(attribute => !attribute.namespace && attribute.localName === 'Name')?.value;
  if (!name) throw xamlFault('SFXAML062', 'A deferred element requires x:Name.', node);
  const lifetime = writer.services.deferElement({name, load, node, context, parent, property,
    instantiate: activation => writer.build(node, {...context, ...activation, deferredActivation: node}),
    attach: value => slots.attach(slot, value), detach: value => slots.detach(slot, value)});
  if (!lifetime?.dispose || !lifetime.snapshot || !lifetime.restore) {
    throw xamlFault('SFXAML062', 'The deferred-element adapter must provide a snapshot-capable lifetime.', directive);
  }
  context.lifetime.add(lifetime);
}
