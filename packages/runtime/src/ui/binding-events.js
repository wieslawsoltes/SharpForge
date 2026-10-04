import {ManagedFault, isReference} from '../heap.js';
import {eventsFor} from '@sharpforge/framework';

const identity = reference => `${reference.h}:${reference.g}`;
const same = (left, right) => left?.h === right?.h && left?.g === right?.g;
const notificationInterfaces = Object.freeze({
  PropertyChanged: 'System.ComponentModel.INotifyPropertyChanged',
  CollectionChanged: 'System.Collections.Specialized.INotifyCollectionChanged'
});

function listenerIndex(listeners) {
  const index = new WeakMap();
  for (const [token, listener] of listeners) {
    const names = index.get(listener.callback) ?? new Map();
    names.set(listener.propertyName, token);
    index.set(listener.callback, names);
  }
  return index;
}

/** Weak INPC/event bridge for the compiler's existing immutable delegate chains and CLI delegates. */
export class ManagedBindingEvents {
  constructor(context, members) {
    this.context = context;
    this.members = members;
    this.heap = context.platform.heap;
    this.entries = new Map();
    this.sources = new Map();
    this.invocations = new Map();
    this.nextId = 1;
    this.nextListener = 1;
    this.listenerCount = 0;
    this.snapshotOwner = Object.freeze({});
    this.maxSubscriptions = context.services?.maxBindingSubscriptions ?? 100000;
    if (!Number.isSafeInteger(this.maxSubscriptions) || this.maxSubscriptions < 1 || this.maxSubscriptions > 1000000) {
      throw new RangeError('Invalid notification budget');
    }
    this.restoring = 0;
  }

  event(source, name) {
    const qualified = notificationInterfaces[name] ? notificationInterfaces[name] + '.' : '';
    for (const type of this.members.ancestry(source)) {
      const field = type?.fields.get(qualified + name) ?? type?.fields.get(name);
      const declared = type?.events.get(qualified + name) ?? type?.events.get(name);
      if (field || declared) return {field, declared, type: field?.type ?? declared.type};
      const add = type?.methods.get(qualified + 'add_' + name + ':1')?.[0] ?? type?.methods.get('add_' + name + ':1')?.[0];
      const remove = type?.methods.get(qualified + 'remove_' + name + ':1')?.[0] ?? type?.methods.get('remove_' + name + ':1')?.[0];
      if (add && remove) return {declared: {add, remove}, type: add.parameters[0]};
    }
    let table = this.heap.get(source).methodTable;
    const seen = new Set();
    while (table && !seen.has(table)) {
      if (seen.size >= this.members.maxDepth) throw new ManagedFault('ExecutionLimitException', 'Notification owner depth exceeded');
      seen.add(table);
      const type = eventsFor(table.name)[name];
      if (type) return {host: true, type};
      table = table.base;
    }
    return null;
  }

  subscribe(source, name, callback, {propertyName = null} = {}) {
    if (!isReference(source)) throw new ManagedFault('ArgumentException', 'A managed notification source is required');
    if (typeof callback !== 'function') throw new TypeError('Notification listener must be callable');
    if (typeof name !== 'string' || !name.length || name.length > 512
      || propertyName !== null && (typeof propertyName !== 'string' || propertyName.length > 512)) {
      throw new ManagedFault('ArgumentException', 'Invalid notification name');
    }
    const sourceKey = identity(source) + '::' + name;
    let entry = this.sources.get(sourceKey);
    if (!entry) {
      const event = this.event(source, name);
      if (!event) return () => {};
      if (this.restoring) throw new ManagedFault('InvalidOperationException', 'Rewind notification subscription is missing');
      if (this.entries.size >= this.maxSubscriptions || this.listenerCount >= this.maxSubscriptions
        || this.nextId > 0x7fffffff || this.nextListener >= Number.MAX_SAFE_INTEGER) {
        throw new ManagedFault('ExecutionLimitException', 'Binding subscription limit exceeded');
      }
      entry = {id: this.nextId++, sourceKey, source: this.heap.createHandle(source, {weak: true}), name, event,
        listeners: new Map(), listenerIndex: new WeakMap()};
      this.entries.set(entry.id, entry);
      this.sources.set(sourceKey, entry);
      try { this.attach(entry, source); }
      catch (error) { this.release(entry, false); throw error; }
    }
    const names = entry.listenerIndex.get(callback) ?? new Map();
    const existing = names.get(propertyName);
    if (!existing && (this.listenerCount >= this.maxSubscriptions || this.nextListener >= Number.MAX_SAFE_INTEGER)) {
      throw new ManagedFault('ExecutionLimitException', 'Notification listener limit exceeded');
    }
    const token = existing ?? this.nextListener++;
    const listener = existing ? entry.listeners.get(token) : {callback, propertyName};
    if (!existing) {
      entry.listeners.set(token, listener);
      names.set(propertyName, token);
      entry.listenerIndex.set(callback, names);
      this.listenerCount++;
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.entries.get(entry.id);
      if (current?.listeners.get(token) !== listener) return;
      current.listeners.delete(token);
      current.listenerIndex.get(callback)?.delete(propertyName);
      this.listenerCount--;
      if (current && !current.listeners.size && !this.restoring) this.release(current);
    };
  }

  delegateLayout(type) {
    const table = this.heap.methodTables.get(type);
    const fields = table.fields;
    const method = fields.findIndex(field => field.name === 'method');
    const next = fields.findIndex(field => field.name === 'next');
    const invoke = this.members.method(type, 'Invoke', 3, {staticOnly: true});
    return method >= 0 && next >= 0 && invoke ? {table, fields, method, next, invoke} : null;
  }

  attach(entry, source) {
    if (entry.event.host) {
      this.heap.withRoots([source], () => {
        entry.sentinel = this.context.platform.delegate(entry.event.type, -entry.id, null);
        this.heap.pins.push(entry.sentinel);
        const list = this.context.platform.get(source, '$event:' + entry.name);
        const handlers = list ? [...this.heap.get(list).data] : [];
        if (handlers.length >= 1024) throw new ManagedFault('ExecutionLimitException', 'Event subscriber limit');
        this.setHostHandlers(entry, source, [...handlers, entry.sentinel]);
      });
      return;
    }
    const layout = this.delegateLayout(entry.event.type);
    entry.layout = layout;
    this.heap.withRoots([source], () => {
      const current = entry.event.field ? this.members.readField(source, entry.event.field) : null;
      if (layout) {
        entry.sentinel = this.createSentinel(entry, current);
        this.invocations.set(layout.invoke.id, layout);
      } else {
        if (current) throw new ManagedFault('NotSupportedException', 'External multicast notification delegates require an event accessor');
        entry.sentinel = this.context.platform.delegate(entry.event.type, -entry.id, null);
      }
      this.heap.pins.push(entry.sentinel);
      if (entry.event.field) this.members.writeField(source, entry.event.field, entry.sentinel);
      else if (entry.event.declared?.add) this.members.invoke(source, entry.event.declared.add, [entry.sentinel]);
      else throw new ManagedFault('MissingMemberException', 'Notification event cannot be subscribed');
    });
  }

  setHostHandlers(entry, source, handlers) {
    const array = this.heap.allocate('array', 'object[]', handlers);
    this.heap.withRoots([source, array], () => this.context.platform.set(source, '$event:' + entry.name, array));
    this.context.platform.command({op: 'event', id: this.context.id(source), event: entry.name, enabled: handlers.length > 0});
  }

  createSentinel(entry, next = null) {
    const layout = entry.layout;
    const values = layout.fields.map(field => field.type.flags.valueType ? 0 : null);
    values[layout.method] = -entry.id;
    values[layout.next] = next;
    return this.heap.object(layout.table, values);
  }

  /** Called by the existing VM call seam before a lowered delegate Invoke method begins. */
  beforeCall(methodId, args) {
    const layout = this.invocations.get(methodId);
    if (!layout || this.restoring) return;
    this.heap.withRoots(args, () => {
      const seen = new Set();
      const delivered = new Set();
      let node = args[0];
      while (node) {
        const id = identity(node);
        if (seen.has(id) || seen.size >= this.maxSubscriptions) throw new ManagedFault('ExecutionLimitException', 'Notification delegate chain limit');
        seen.add(id);
        const record = this.heap.get(node);
        const entry = this.entries.get(-record.data[layout.method]);
        if (entry && !delivered.has(entry.id)) { delivered.add(entry.id); this.deliver(entry, args.slice(1)); }
        node = record.data[layout.next];
      }
    });
  }

  /** A raw CLI delegate remains a regular managed record with a session-owned callback identity. */
  invokeDelegate(delegate, args) {
    if (!isReference(delegate) || this.heap.get(delegate).kind !== 'delegate') return {handled: false};
    const id = -this.context.platform.get(delegate, 'method');
    const entry = this.entries.get(id);
    if (!entry) return {handled: false};
    if (!this.restoring) this.heap.withRoots([delegate, ...args], () => this.deliver(entry, args));
    return {handled: true, value: null};
  }

  deliver(entry, args) {
    if (!this.heap.getHandle(entry.source)) { this.release(entry, false); return; }
    const argument = args[1];
    const model = argument ? this.context.unwrapModel(argument) : null;
    const changedName = entry.name === 'PropertyChanged' && argument
      ? model?.values?.PropertyName ?? this.context.native(this.context.read(argument, 'PropertyName')) : null;
    for (const {callback, propertyName} of [...entry.listeners.values()]) {
      if (propertyName && changedName && propertyName !== changedName && !(propertyName === 'Item' && changedName === 'Item[]')) continue;
      callback(args[0], argument);
    }
  }

  removeSentinel(entry, head) {
    if (!entry.layout) return same(head, entry.sentinel) ? null : head;
    const layout = entry.layout;
    const prefix = [];
    const seen = new Set();
    let node = head;
    while (node) {
      const id = identity(node);
      if (seen.has(id) || seen.size >= this.maxSubscriptions) throw new ManagedFault('ExecutionLimitException', 'Notification delegate chain limit');
      seen.add(id);
      const record = this.heap.get(node);
      if (record.data[layout.method] === -entry.id) {
        let tail = record.data[layout.next];
        for (let index = prefix.length - 1; index >= 0; index--) {
          const values = [...this.heap.get(prefix[index]).data];
          values[layout.next] = tail;
          tail = this.heap.object(layout.table, values);
          this.heap.pins.push(tail);
        }
        return tail;
      }
      prefix.push(node);
      node = record.data[layout.next];
    }
    return head;
  }

  release(entry, detach = true) {
    const source = this.heap.getHandle(entry.source);
    try {
      if (detach && source && !this.restoring) this.detach(entry, source);
    } finally {
      this.heap.releaseHandle(entry.source);
      this.sources.delete(entry.sourceKey);
      this.entries.delete(entry.id);
      this.listenerCount -= entry.listeners.size;
      entry.listeners.clear();
      entry.listenerIndex = new WeakMap();
    }
  }

  detach(entry, source) {
    this.heap.withRoots([source], () => {
      if (entry.event.host) {
        const reference = this.context.platform.get(source, '$event:' + entry.name);
        const handlers = reference ? this.heap.get(reference).data : [];
        this.setHostHandlers(entry, source, handlers.filter(handler => this.heap.get(handler).kind !== 'delegate'
          || this.context.platform.get(handler, 'method') !== -entry.id));
      } else if (entry.event.field) {
        const current = this.members.readField(source, entry.event.field);
        const next = this.removeSentinel(entry, current);
        this.members.writeField(source, entry.event.field, next);
      } else if (entry.event.declared?.remove) {
        const sentinel = entry.layout ? this.createSentinel(entry) : entry.sentinel;
        this.heap.pins.push(sentinel);
        this.members.invoke(source, entry.event.declared.remove, [sentinel]);
      }
    });
  }

  beginRestore() { this.restoring++; }
  endRestore() { this.restoring = Math.max(0, this.restoring - 1); }
  prune() { for (const entry of this.entries.values()) if (!this.heap.getHandle(entry.source)) this.release(entry, false); }

  snapshot() {
    return {version: 1, owner: this.snapshotOwner, nextId: this.nextId, nextListener: this.nextListener,
      entries: [...this.entries.values()].map(entry => ({...entry, listeners: [...entry.listeners]}))};
  }

  /** Heap restoration already reinstates sentinel nodes; restore only native indexes and callbacks. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.owner !== this.snapshotOwner || !Array.isArray(snapshot.entries)
      || snapshot.entries.length > this.maxSubscriptions || !Number.isInteger(snapshot.nextId) || snapshot.nextId < 1
      || snapshot.nextId > 0x80000000 || !Number.isSafeInteger(snapshot.nextListener) || snapshot.nextListener < 1) {
      throw new ManagedFault('ArgumentException', 'Invalid notification subscription snapshot');
    }
    const entries = new Map();
    const sources = new Map();
    const invocations = new Map();
    const tokens = new Set();
    for (const data of snapshot.entries) {
      this.validateSnapshotEntry(data, snapshot, entries, sources, tokens);
      const entry = {...data, listeners: new Map(data.listeners)};
      entry.listenerIndex = listenerIndex(entry.listeners);
      entries.set(entry.id, entry);
      sources.set(entry.sourceKey, entry);
      if (entry.layout) invocations.set(entry.layout.invoke.id, entry.layout);
    }
    this.entries = entries;
    this.sources = sources;
    this.invocations = invocations;
    this.listenerCount = tokens.size;
    this.nextId = snapshot.nextId;
    this.nextListener = snapshot.nextListener;
  }

  validateSnapshotEntry(data, snapshot, entries, sources, tokens) {
    const fail = () => { throw new ManagedFault('ArgumentException', 'Invalid notification snapshot entry'); };
    if (!data || !Number.isInteger(data.id) || data.id < 1 || data.id >= snapshot.nextId || entries.has(data.id)
      || typeof data.sourceKey !== 'string' || data.sourceKey.length > 1024 || sources.has(data.sourceKey)
      || typeof data.name !== 'string' || !data.name.length || data.name.length > 512
      || data.source?.owner !== this.heap.handleOwner || !Number.isSafeInteger(data.source?.id) || data.source.id < 1
      || !data.event || !Array.isArray(data.listeners) || data.listeners.length > this.maxSubscriptions) fail();
    if (data.layout && (!data.layout.invoke || !Number.isSafeInteger(data.layout.invoke.id))) fail();
    const callbacks = new WeakMap();
    for (const entry of data.listeners) {
      if (!Array.isArray(entry) || entry.length !== 2) fail();
      const [token, listener] = entry;
      if (!Number.isSafeInteger(token) || token < 1 || token >= snapshot.nextListener || tokens.has(token)
        || typeof listener?.callback !== 'function' || tokens.size >= this.maxSubscriptions
        || listener.propertyName !== null && (typeof listener.propertyName !== 'string' || listener.propertyName.length > 512)) fail();
      const names = callbacks.get(listener.callback) ?? new Set();
      if (names.has(listener.propertyName)) fail();
      names.add(listener.propertyName);
      callbacks.set(listener.callback, names);
      tokens.add(token);
    }
  }

  dispose() {
    const errors = [];
    for (const entry of [...this.entries.values()]) {
      try { this.release(entry); }
      catch (error) { errors.push(error); }
    }
    this.invocations.clear();
    if (errors.length) throw new AggregateError(errors, 'Managed binding notification disposal failed');
  }
}
