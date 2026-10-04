import {WorkbenchEvents} from '../events.js';

/** Bounded delivery-time events/memory and worker-measured CPU samples, partitioned by composite launch identity. */
export class DiagnosticTimeline extends WorkbenchEvents {
  constructor({limit = 2000, maxHistories = 128, clock = () => performance.now()} = {}) {
    super();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError('Invalid diagnostic sample limit');
    if (!Number.isSafeInteger(maxHistories) || maxHistories < 1 || maxHistories > 256) throw new RangeError('Invalid diagnostic launch limit');
    Object.assign(this, {limit, maxHistories, clock});
    this.sessions = new Map();
    this.histories = new Map();
    this.serial = 0;
    this.disposed = false;
  }

  history(appId, {identity = appId, name = appId, projectId, runtimeSession, generation} = {}) {
    let history = this.histories.get(identity);
    if (!history) {
      history = {id: identity, appId, identity, name, projectId, runtimeSession, generation,
        startedAt: this.clock(), events: [], samples: [], cpuSamples: [], snapshots: [], executionError: null};
      this.histories.set(identity, history);
      while (this.histories.size > this.maxHistories) {
        const key = this.histories.keys().next().value, removed = this.histories.get(key);
        this.histories.delete(key);
        if (this.sessions.get(removed.appId) === removed) this.sessions.delete(removed.appId);
      }
    }
    this.sessions.set(appId, history);
    return history;
  }

  bind(session) {
    return this.history(session.id, {identity: session.identity ?? session.id, name: session.name ?? session.id,
      projectId: session.projectId, runtimeSession: session.runtimeSession, generation: session.worker?.generation});
  }

  record(sessionId, event = {}, identity = {}) {
    if (this.disposed) return;
    const history = this.history(sessionId, {...identity, identity: identity.identity ?? event.identity ?? sessionId});
    const timestamp = this.clock() - history.startedAt;
    history.events.push({id: 'event:' + ++this.serial, timestamp, kind: String(event.type ?? event.event ?? 'state').slice(0, 80),
      description: String(event.description ?? event.reason?.description ?? event.state ?? '').slice(0, 2048),
      state: event.state, uri: event.point?.uri, line: event.point?.line});
    if (history.events.length > this.limit) history.events.shift();
    const stats = event.stats ?? event.debug?.stats;
    if (stats) {
      history.samples.push({timestamp, liveBytes: stats.heap?.liveBytes ?? stats.liveBytes,
        liveObjects: stats.heap?.liveObjects ?? stats.liveObjects, instructions: stats.instructions});
      if (history.samples.length > this.limit) history.samples.shift();
    }
    this.emit({type: 'sample', sessionId, identity: history.identity});
  }

  execution(session, batch) {
    if (this.disposed) return;
    const history = this.bind(session);
    if (batch.truncated && (history.cpuSamples.at(-1)?.sequence ?? 0) < batch.firstSequence - 1) {
      this.record(session.id, {event: 'execution-gap', description: 'Older worker activity samples expired from the bounded capture.'}, history);
    }
    for (const sample of batch.samples) {
      if (sample.sequence <= (history.cpuSamples.at(-1)?.sequence ?? 0)) continue;
      history.cpuSamples.push({...sample, timestamp: sample.endMs, identity: history.identity});
    }
    if (history.cpuSamples.length > this.limit) history.cpuSamples.splice(0, history.cpuSamples.length - this.limit);
    history.executionError = null;
    history.executionActive = batch.active;
    history.totalBusyMs = batch.totalBusyMs;
    this.emit({type: 'execution', sessionId: session.id, identity: history.identity});
  }

  executionFailure(session, error) {
    const history = this.bind(session);
    if (history.executionError === error.message) return;
    history.executionError = error.message;
    this.record(session.id, {event: 'execution-unavailable', description: error.message}, history);
  }

  async snapshot(session) {
    if (!session) throw new Error('Select an app session before taking a heap snapshot');
    const identity = session.identity ?? session.id;
    const census = await session.request('heapCensus');
    if (this.disposed || (session.identity ?? session.id) !== identity) throw new Error('Application launch changed while taking the heap snapshot');
    if (!Number.isSafeInteger(census.objects) || census.objects < 0 || !Number.isSafeInteger(census.bytes) || census.bytes < 0 ||
        !Array.isArray(census.types) || census.types.length > 10_000 || census.types.some(item =>
          typeof item.type !== 'string' || item.type.length > 1024 || !Number.isSafeInteger(item.objects) || item.objects < 0 ||
          !Number.isSafeInteger(item.bytes) || item.bytes < 0)) {
      throw new Error('Heap census is invalid or exceeds the 10,000-type snapshot limit');
    }
    const history = this.bind(session);
    const result = {id: 'snapshot:' + ++this.serial, timestamp: this.clock() - history.startedAt, identity,
      stamp: census.stamp, objects: census.objects, bytes: census.bytes,
      types: census.types.map(item => ({kind: item.kind, type: item.type, objects: item.objects, bytes: item.bytes}))};
    history.snapshots.push(result);
    if (history.snapshots.length > 20) history.snapshots.shift();
    this.emit({type: 'snapshot', sessionId: session.id, identity});
    return result;
  }

  diff(sessionId, beforeId, afterId) {
    const snapshots = (this.histories.get(sessionId) ?? this.sessions.get(sessionId))?.snapshots ?? [];
    const before = snapshots.find(item => item.id === beforeId), after = snapshots.find(item => item.id === afterId);
    if (!before || !after || before.identity !== after.identity) throw new Error('Select two snapshots from the same session launch');
    const key = item => (item.kind ?? '') + ':' + item.type;
    const row = item => ({...(item.kind === undefined ? {} : {kind: item.kind}), type: item.type, objects: 0, bytes: 0});
    const types = new Map((before.types ?? []).map(item => [key(item), {...row(item), objects: -item.objects, bytes: -item.bytes}]));
    for (const item of after.types ?? []) {
      const previous = types.get(key(item)) ?? row(item);
      previous.objects += item.objects;
      previous.bytes += item.bytes;
      types.set(key(item), previous);
    }
    return {objects: after.objects - before.objects, bytes: after.bytes - before.bytes, types: [...types.values()]};
  }

  dispose() {
    this.disposed = true;
    this.histories.clear();
    this.sessions.clear();
    super.dispose();
  }
}
