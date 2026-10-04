import {IndependentTimelineHost} from '../animation/independent-timelines.js';
import {Compositor} from './compositor.js';
import {encodeCompositionValue, decodeCompositionValue, serializeCompositionGraph, applyCompositionGraph} from './transport-codec.js';

/** Worker side sends retained graph mutations and animation definitions, never frame-by-frame property writes. */
export class CompositionTransport {
  constructor({emit, session, enqueue = callback => queueMicrotask(callback)} = {}) {
    if (typeof emit !== 'function' || typeof session !== 'string' || !session || session.length > 128) throw new TypeError('Composition transport needs emit/session');
    this.emit = emit;
    this.session = session;
    this.enqueue = enqueue;
    this.compositor = null;
    this.dirty = false;
    this.queued = false;
    this.closed = false;
    this.completions = new Map();
  }
  connect(compositor) {
    if (this.compositor && this.compositor !== compositor) throw new TypeError('Transport already belongs to a Compositor');
    this.compositor = compositor;
    compositor.transport = this;
    this.changed();
  }
  send(op, values) { this.emit({version: 1, op, session: this.session, ...values}); }
  changed() {
    if (this.closed) return;
    this.dirty = true;
    if (this.queued) return;
    this.queued = true;
    this.enqueue(() => { this.queued = false; if (!this.closed) this.flush(); });
  }
  flush() {
    if (!this.dirty || this.closed || !this.compositor) return;
    const graph = serializeCompositionGraph(this.compositor);
    this.dirty = false;
    this.send('composition-graph', {graph});
  }
  animationStarted(record) {
    this.flush();
    const completionToken = this.session + ':' + record.id;
    this.completions.set(completionToken, record);
    this.send('composition-animation', {targetId: record.target.id, property: record.property,
      definition: encodeCompositionValue(record.definition), completionToken, stopBehavior: record.animation.StopBehavior ?? 0});
  }
  animationStopped(record, {restoreBase = false} = {}) {
    if (this.closed) return;
    const completionToken = this.session + ':' + record.id;
    this.completions.delete(completionToken);
    this.send('composition-stop', {targetId: record.target.id, property: record.property, restoreBase});
  }
  complete(completionToken) {
    const record = this.completions.get(completionToken);
    if (!record || this.closed) return false;
    this.completions.delete(completionToken);
    if (!record.expression && this.compositor.animations.clock.state(record.id).state !== 1) {
      this.compositor.animations.clock.skipToFill(record.id);
    } else this.compositor.animations.complete(record);
    return true;
  }
  preview(elementId, entry) {
    this.flush();
    this.send('composition-preview', {elementId, visualId: entry?.visual.id ?? null, childId: entry?.child?.id ?? null,
      translationEnabled: !!entry?.translationEnabled});
  }
  brush(elementId, property, brush) {
    if (brush && (brush.Compositor !== this.compositor || brush.closed || !brush.kind.endsWith('Brush'))) {
      throw new TypeError('Transported brush must belong to this Compositor');
    }
    this.flush();
    this.send('composition-brush', {elementId, property, brushId: brush?.id ?? null});
  }
  retainedValues() { return [this.compositor]; }
  snapshot() { return {dirty: this.dirty, completions: [...this.completions]}; }
  restore(snapshot) { this.closed = false; this.completions = new Map(snapshot.completions); this.dirty = true; this.flush(); }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.send('composition-dispose', {});
    if (this.compositor?.transport === this) this.compositor.transport = null;
    this.completions.clear();
  }
}

/** Host side runs independent animation on the shared rendering scheduler. */
export class CompositionTransportHost {
  constructor({clockFactory, scheduler, onRender, onInvalidate, onCompleted = () => {}, setElementComposition = () => {},
    readProperty, applyProperty, clearProperty, setBrush = () => {}} = {}) {
    this.options = {clockFactory, scheduler, onRender, onInvalidate};
    this.onCompleted = onCompleted;
    this.setElementComposition = setElementComposition;
    this.setBrush = setBrush;
    this.sessions = new Map();
    this.independent = applyProperty ? new IndependentTimelineHost({clockFactory, scheduler, readProperty, applyProperty, clearProperty, onCompleted}) : null;
    this.closed = false;
  }
  receive(packet) {
    if (this.closed || packet?.version !== 1 || typeof packet.session !== 'string' || !packet.session || packet.session.length > 128) {
      throw new TypeError('Invalid or closed composition transport');
    }
    if (packet.op?.startsWith('xaml-timeline-')) {
      if (!this.independent) throw new TypeError('Independent timeline host callbacks are missing');
      this.independent.receive(packet);
      return;
    }
    let session = this.sessions.get(packet.session);
    if (packet.op === 'composition-graph') {
      if (!session) {
        if (this.sessions.size >= 32) throw new RangeError('Composition session limit exceeded');
        session = {compositor: new Compositor(this.options), objects: new Map(), previews: new Map(), brushes: new Map()};
        this.sessions.set(packet.session, session);
      }
      session.objects = applyCompositionGraph(session.compositor, packet.graph, session.objects);
      return;
    }
    if (!session) throw new TypeError('Composition session has no graph');
    if (packet.op === 'composition-dispose') { this.disposeSession(packet.session); return; }
    if (packet.op === 'composition-preview') {
      if (typeof packet.elementId !== 'string') throw new TypeError('Composition preview requires an element identity');
      const visual = session.objects.get(packet.visualId);
      const child = session.objects.get(packet.childId) ?? null;
      if (packet.visualId !== null && (!visual?.kind.endsWith('Visual') || visual.closed)) throw new TypeError('Invalid preview visual');
      if (packet.childId !== null && (!child?.kind.endsWith('Visual') || child.closed)) throw new TypeError('Invalid preview child');
      const entry = visual ? {visual, child, translationEnabled: !!packet.translationEnabled} : null;
      if (entry) session.previews.set(packet.elementId, entry);
      else session.previews.delete(packet.elementId);
      this.setElementComposition(packet.elementId, entry);
      return;
    }
    if (packet.op === 'composition-brush') {
      if (typeof packet.elementId !== 'string' || !['Background', 'Foreground', 'BorderBrush'].includes(packet.property)) {
        throw new TypeError('Invalid composition brush binding');
      }
      const brush = packet.brushId === null ? null : session.objects.get(packet.brushId);
      if (packet.brushId !== null && (!brush?.kind.endsWith('Brush') || brush.closed)) throw new TypeError('Invalid composition brush');
      const key = packet.elementId + '|' + packet.property;
      if (brush) session.brushes.set(key, {elementId: packet.elementId, property: packet.property, brush});
      else session.brushes.delete(key);
      this.setBrush(packet.elementId, packet.property, brush);
      return;
    }
    const target = session.objects.get(packet.targetId);
    if (!target || typeof packet.property !== 'string') throw new TypeError('Invalid transported animation target');
    if (packet.op === 'composition-stop') {
      if (packet.restoreBase !== undefined && typeof packet.restoreBase !== 'boolean') throw new TypeError('Invalid animation stop policy');
      session.compositor.animations.stop(target, packet.property, {restoreBase: packet.restoreBase ?? false});
      return;
    }
    if (packet.op !== 'composition-animation') throw new TypeError('Unknown composition transport operation');
    if (typeof packet.completionToken !== 'string' || packet.completionToken.length > 256) throw new TypeError('Invalid completion token');
    const definition = decodeCompositionValue(packet.definition, session.objects);
    const animation = {Compositor: session.compositor, kind: 'TransportedAnimation', StopBehavior: packet.stopBehavior,
      definition: () => definition, listeners: new Set([() => this.onCompleted(packet.completionToken)])};
    if (definition.ast) animation.compile = () => definition;
    target.StartAnimation(packet.property, animation);
  }
  disposeSession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const element of session.previews.keys()) this.setElementComposition(element, null);
    for (const {elementId, property} of session.brushes.values()) this.setBrush(elementId, property, null);
    session.compositor.dispose();
    this.sessions.delete(id);
  }
  snapshot() {
    return {sessions: [...this.sessions].map(([id, session]) => ({id, session, compositor: session.compositor.snapshot(),
      objects: [...session.objects], previews: [...session.previews], brushes: [...session.brushes]})),
    independent: this.independent?.snapshot() ?? null};
  }
  restore(snapshot) {
    for (const id of this.sessions.keys()) if (!snapshot.sessions.some(entry => entry.id === id)) this.disposeSession(id);
    for (const entry of snapshot.sessions) {
      entry.session.compositor.restore(entry.compositor);
      entry.session.objects = new Map(entry.objects);
      for (const id of entry.session.previews.keys()) this.setElementComposition(id, null);
      for (const {elementId, property} of entry.session.brushes.values()) this.setBrush(elementId, property, null);
      entry.session.previews = new Map(entry.previews);
      entry.session.brushes = new Map(entry.brushes);
      this.sessions.set(entry.id, entry.session);
      for (const [id, preview] of entry.session.previews) this.setElementComposition(id, preview);
      for (const {elementId, property, brush} of entry.session.brushes.values()) this.setBrush(elementId, property, brush);
    }
    if (snapshot.independent) this.independent?.restore(snapshot.independent);
    this.closed = false;
  }
  dispose() {
    for (const id of [...this.sessions.keys()]) this.disposeSession(id);
    this.independent?.dispose();
    this.closed = true;
  }
}
