import {encodeCompositionValue} from '../composition/transport-codec.js';

const properties = new Set(['Opacity', '$Left', '$Top', 'X', 'Y', 'TranslateX', 'TranslateY', 'ScaleX', 'ScaleY', 'Angle', 'Rotation']);
const controls = Object.freeze({Pause: 'pause', Resume: 'resume', Stop: 'stop', SkipToFill: 'skipToFill', Seek: 'seek', SeekAlignedToLastTick: 'seek'});

function eligible(node, depth = 0, budget = {nodes: 0}) {
  if (!node || depth > 16 || ++budget.nodes > 512) return false;
  if (node.children) return Array.isArray(node.children) && node.children.every(child => eligible(child, depth + 1, budget));
  return ['Double', 'Scalar'].includes(node.valueKind ?? 'Double') && properties.has(node.property);
}

function transferDefinition(node, identity, bases, clock) {
  const result = {};
  for (const [name, value] of Object.entries(node)) {
    if (['ref', 'target', 'children'].includes(name)) continue;
    result[name] = value === Infinity ? {$infiniteDuration: true} : encodeCompositionValue(value);
  }
  if (node.target !== undefined) {
    result.target = identity(node.target);
    bases.push({target: result.target, property: node.property, value: encodeCompositionValue(clock.getBase(node.target, node.property))});
  }
  if (node.children) result.children = node.children.map(child => transferDefinition(child, identity, bases, clock));
  return result;
}

function restoreDefinition(node, depth = 0) {
  if (!node || depth > 16) throw new TypeError('Invalid independent timeline definition');
  const result = {...node};
  if (node.duration?.$infiniteDuration === true) result.duration = Infinity;
  if (node.children) result.children = node.children.map(child => restoreDefinition(child, depth + 1));
  return result;
}

/** Managed side holds a paused deterministic clock and sends only definitions, controls and completion boundaries. */
export class IndependentTimelineTransport {
  constructor({emit, session, clock, identity = value => value, now = () => performance.now()} = {}) {
    if (!clock || typeof emit !== 'function' || typeof session !== 'string') throw new TypeError('Independent timeline transport needs clock/emit/session');
    this.emit = emit;
    this.session = session;
    this.clock = clock;
    this.identity = identity;
    this.now = now;
    this.records = new Map();
    this.closed = false;
  }
  send(op, values) { this.emit({version: 1, session: this.session, op: 'xaml-timeline-' + op, ...values}); }
  begin(id, definition) {
    if (this.closed || !eligible(definition)) return false;
    const bases = [];
    const transferred = transferDefinition(definition, this.identity, bases, this.clock);
    this.clock.begin(id, definition);
    this.clock.pause(id);
    this.records.set(id, {id, definition, transferred, bases, time: 0, started: this.now(), paused: false, completions: new Set()});
    this.send('begin', {id, definition: transferred, bases});
    return true;
  }
  control(id, operation, time) {
    const record = this.records.get(id);
    if (!record || !controls[operation]) return false;
    this.synchronize(record);
    const action = controls[operation];
    this.clock[action](id, time);
    record.time = this.clock.state(id).time;
    record.started = this.now();
    if (action === 'pause' || action === 'resume') record.paused = action === 'pause';
    this.clock.pause(id);
    this.send('control', {id, action, time: time ?? null});
    if (action === 'stop') this.records.delete(id);
    return true;
  }
  synchronize(record) {
    if (!record.paused) this.clock.seek(record.id, record.time + Math.max(0, this.now() - record.started));
  }
  state(id) {
    const record = this.records.get(id);
    if (record) this.synchronize(record);
    const state = this.clock.state(id);
    return record ? {...state, paused: record.paused} : state;
  }
  complete({id, completedId, time}) {
    const record = this.records.get(id);
    if (!record || record.completions.has(completedId) || !Number.isFinite(time) || time < 0) return false;
    record.completions.add(completedId);
    this.clock.seek(id, time);
    record.time = time;
    record.started = this.now();
    return true;
  }
  advanceManual(delta) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Invalid manual animation delta');
    for (const record of this.records.values()) {
      if (record.paused) continue;
      record.time = this.clock.state(record.id).time + delta;
      record.started = this.now();
      this.clock.seek(record.id, record.time);
      this.send('control', {id: record.id, action: 'seek', time: record.time});
    }
  }
  retainedValues() { return this.clock.roots(); }
  snapshot() { return [...this.records].map(([id, record]) => [id, {...record, completions: [...record.completions]}]); }
  restore(snapshot) {
    this.closed = false;
    this.records = new Map(snapshot.map(([id, record]) => [id, {...record, started: this.now(), completions: new Set(record.completions)}]));
    for (const record of this.records.values()) {
      this.send('begin', {id: record.id, definition: record.transferred, bases: record.bases});
      this.send('control', {id: record.id, action: 'seek', time: record.time});
      if (record.paused) this.send('control', {id: record.id, action: 'pause', time: null});
    }
  }
  dispose() {
    if (this.closed) return;
    for (const id of this.records.keys()) { this.send('control', {id, action: 'stop', time: null}); this.clock.stop(id); }
    this.records.clear();
    this.closed = true;
  }
}

/** Rendering host applies transient composition properties; each completed timeline emits one boundary packet. */
export class IndependentTimelineHost {
  constructor({clockFactory, scheduler, readProperty, applyProperty, clearProperty, onCompleted = () => {}} = {}) {
    this.scheduler = scheduler;
    this.applyProperty = applyProperty;
    this.values = new Map();
    this.bases = new Map();
    this.owners = new Map();
    this.sessions = new Map();
    this.targetIds = new Map();
    const key = (target, property) => target + '|' + property;
    const read = (target, property) => readProperty?.(this.targetIds.get(target).id, property, this.targetIds.get(target).session);
    const apply = (target, property, value) => applyProperty(this.targetIds.get(target).id, property, value);
    this.clock = clockFactory({key: target => target,
      read: (target, property) => this.values.get(key(target, property)) ?? read(target, property) ?? this.bases.get(key(target, property)),
      readBase: (target, property) => read(target, property) ?? this.bases.get(key(target, property)),
      validate: (target, property) => {
        if (typeof target !== 'string' || !properties.has(property) || typeof applyProperty !== 'function') {
          throw new TypeError('Invalid independent host animation target');
        }
      },
      write: (target, property, value) => { this.values.set(key(target, property), value); apply(target, property, value); },
      clear: (target, property) => { this.values.delete(key(target, property)); if (clearProperty) clearProperty(this.targetIds.get(target).id, property);
        else apply(target, property, read(target, property) ?? this.bases.get(key(target, property))); },
      completed: completedId => {
        const root = this.owners.get(completedId);
        if (root) onCompleted({session: root.session, id: root.id, completedId, time: this.clock.state(root.key).time});
      }});
    this.removeFrame = scheduler?.register('animation', this, context => { this.clock.advance(context.delta); this.schedule(); });
  }
  receive(packet) {
    if (packet?.version !== 1 || typeof packet.session !== 'string' || packet.session.length > 128 || typeof packet.id !== 'string') {
      throw new TypeError('Invalid independent timeline packet');
    }
    const key = packet.session + ':' + packet.id;
    if (packet.op === 'xaml-timeline-begin') {
      if (!eligible(packet.definition) || !Array.isArray(packet.bases) || packet.bases.length > 512) throw new TypeError('Invalid independent timeline payload');
      const definition = restoreDefinition(packet.definition);
      for (const base of packet.bases) {
        const alias = packet.session + '/' + base.target;
        this.targetIds.set(alias, {id: base.target, session: packet.session});
        this.bases.set(alias + '|' + base.property, base.value);
      }
      const associate = node => {
        if (node.target !== undefined) node.target = packet.session + '/' + node.target;
        const original = node.id;
        node.id = packet.session + ':' + original;
        this.owners.set(node.id, {key, id: packet.id, session: packet.session});
        for (const child of node.children ?? []) associate(child);
      };
      associate(definition);
      this.clock.begin(key, definition);
      this.sessions.set(key, packet.session);
    } else if (packet.op === 'xaml-timeline-control') {
      if (!Object.values(controls).includes(packet.action)) throw new TypeError('Invalid independent timeline control');
      this.clock[packet.action](key, packet.time);
      if (packet.action === 'stop') {
        this.sessions.delete(key);
        for (const [id, owner] of this.owners) if (owner.key === key) this.owners.delete(id);
        this.pruneTargets();
      }
    } else throw new TypeError('Unknown independent timeline operation');
    this.schedule();
  }
  schedule() { this.scheduler?.setContinuous(this, this.clock.running); }
  disposeSession(session) {
    for (const [key, owner] of this.sessions) if (owner === session) { this.clock.stop(key); this.sessions.delete(key); }
    for (const [id, owner] of this.owners) if (owner.session === session) this.owners.delete(id);
    this.pruneTargets();
    this.schedule();
  }
  pruneTargets() {
    for (const base of this.bases.keys()) if (!this.clock.bases.has(base)) this.bases.delete(base);
    const targets = new Set([...this.bases.keys()].map(key => key.slice(0, key.lastIndexOf('|'))));
    for (const target of this.targetIds.keys()) if (!targets.has(target)) this.targetIds.delete(target);
  }
  snapshot() { return {clock: this.clock.snapshot(), values: [...this.values], bases: [...this.bases], owners: [...this.owners], sessions: [...this.sessions], targetIds: [...this.targetIds]}; }
  restore(snapshot) {
    this.values = new Map(snapshot.values);
    this.bases = new Map(snapshot.bases);
    this.owners = new Map(snapshot.owners);
    this.sessions = new Map(snapshot.sessions);
    this.targetIds = new Map(snapshot.targetIds);
    this.clock.restore(snapshot.clock);
    this.clock.apply();
    this.schedule();
  }
  dispose() {
    this.removeFrame?.();
    this.clock.clear();
    this.scheduler?.setContinuous(this, false);
    this.values.clear();
    this.bases.clear();
    this.owners.clear();
    this.sessions.clear();
    this.targetIds.clear();
  }
}
