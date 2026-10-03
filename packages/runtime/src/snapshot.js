import {ManagedFault} from './heap.js';
import {validateSnapshotState} from './snapshot-validation.js';

/** Clone execution graphs, preserving aliases, immutable handles and fault identity. */
export function copyExecution(value, memo = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (memo.has(value)) return memo.get(value);
  // Freezing a Map or Set does not freeze its contents.
  if (value instanceof Map) {
    const copy = new Map(); memo.set(value, copy);
    for (const [key, item] of value) copy.set(copyExecution(key, memo), copyExecution(item, memo));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set(); memo.set(value, copy);
    for (const item of value) copy.add(copyExecution(item, memo));
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0); memo.set(value, copy); return copy;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = copyExecution(value.buffer, memo);
    const copy = value instanceof DataView
      ? new DataView(buffer, value.byteOffset, value.byteLength)
      : new value.constructor(buffer, value.byteOffset, value.length);
    memo.set(value, copy); return copy;
  }
  if (Object.isFrozen(value)) return value;
  if (value instanceof ManagedFault) {
    const copy = new ManagedFault(value.name, value.message, value.reference); memo.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = copyExecution(value[key], memo);
    return copy;
  }
  const copy = Array.isArray(value) ? [] : {}; memo.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = copyExecution(item, memo);
  return copy;
}

/** Method bodies and decode maps belong to the code generation, not execution state. */
export function copyFrames(frames, memo = new Map()) {
  if(memo.has(frames))return memo.get(frames);
  const copied=[];memo.set(frames,copied);
  for(const frame of frames) {
    if(memo.has(frame)){copied.push(memo.get(frame));continue;}
    const copy={};memo.set(frame,copy);copied.push(copy);
    const {method, offsets, ...execution} = frame;
    Object.assign(copy,copyExecution(execution,memo),method?{method,offsets}:{});
  }
  return copied;
}

export const snapshotSchemaVersion = 2;
const field = (name, copier = copyExecution, options = {}) => Object.freeze({name, copier, ...options});
const component = name => field(name, null, {component: true});
const retain = value => value;
const entries = (value, memo) => copyExecution([...value], memo);
const common = [
  component('platform'), component('scheduler'), field('frames', copyFrames), component('heap'),
  field('typeObjects', copyExecution, {optional: true}),
  field('statics'), field('fault'), field('pendingFault'), field('state', retain),
  field('instructions', retain), field('elapsedMs', retain), field('frameId', retain, {monotonic: true}),
  field('output'), field('outputCharacters', retain), field('returnValue'), field('exitCode', retain),
  field('writeRevision', retain), field('pendingWrite', copyExecution, {optional: true})
];
const exclusions = {
  options: 'Host configuration is retained by the owning VM.',
  snapshotOwner: 'Snapshots are scoped to their original VM instance.',
  onOutput: 'Host callback, retained across restore.',
  onException: 'Debugger callback, retained across restore.',
  onWrite: 'Debugger callback, retained across restore.',
  notifyWrite: 'Designer transaction callback override, retained across restore.',
  symbols: 'Debug metadata belongs to the current code generation.'
};
const schema = (engine, fields, excluded) => Object.freeze({
  schemaVersion: snapshotSchemaVersion, engine,
  fields: Object.freeze(fields), excluded: Object.freeze({...exclusions, ...excluded})
});

/** Every own VM field is explicitly captured or classified as host/derived metadata. */
export const snapshotSchemas = Object.freeze({
  source: schema('source', [...common,
    field('strings'), field('stack'), field('constantValues', entries, {restore: value => new Map(value)}),
    field('sourcePause', retain), field('currentPoint')
  ], {image: 'Immutable bytecode for the current code generation.'}),
  cil: schema('cil', [...common,
    field('strings'), field('initialized'),
    field('stack', copyExecution, {optional: true}),
    field('currentPoint', copyExecution, {optional: true}),
    field('sourcePause', retain, {optional: true})
  ], {
    inspector: 'Assembly metadata for the current code generation.',
    report: 'Verification report for the current code generation.',
    returnType: 'Entry-point signature metadata.',
    loadMs: 'Assembly load measurement is not execution state.',
    layoutCache: 'Derived type layouts; invalidated when code changes.',
    _typeSystem: 'Derived metadata indexes; invalidated when code changes.',
    entryToken: 'Debugger entry-point selection.'
  })
});

export function assertSnapshotFields(vm, engine) {
  const selected = snapshotSchemas[engine];
  if (!selected) throw new TypeError(`Unknown snapshot engine '${engine}'`);
  const known = new Set([...selected.fields.map(item => item.name), ...Object.keys(selected.excluded)]);
  const unknown = Object.keys(vm).filter(name => !known.has(name));
  if (unknown.length) throw new TypeError(`Unregistered ${engine} VM snapshot fields: ${unknown.join(', ')}`);
  return selected;
}

/** In-memory snapshots contain no transferable host/native resources. */
export function snapshotVM(vm, engine) {
  const selected = assertSnapshotFields(vm, engine), memo = new Map();
  const snapshot = {
    schemaVersion: selected.schemaVersion, engine, owner: vm.snapshotOwner,
    codeOwner: vm.inspector??vm.image,
    hostRevision: vm.platform.hostOperations.snapshotVersion()
  };
  for (const item of selected.fields) {
    if (item.optional && !Object.hasOwn(vm, item.name)) continue;
    snapshot[item.name] = item.component
      ? item.name==='scheduler'?vm.scheduler.snapshot(memo):copyExecution(vm[item.name].snapshot(),memo)
      : item.copier(vm[item.name], memo);
  }
  if (engine === 'cil') snapshot.heapRevision = vm.heap.mutationRevision;
  return snapshot;
}

export function restoreVM(vm, snapshot, engine) {
  const selected = assertSnapshotFields(vm, engine);
  if (snapshot?.owner !== vm.snapshotOwner) throw new TypeError(`Snapshot belongs to another ${engine === 'cil' ? 'CIL' : 'source'} VM`);
  if (snapshot.schemaVersion !== selected.schemaVersion || snapshot.engine !== engine)
    throw new TypeError(`Unsupported ${engine} VM snapshot schema version`);
  if(snapshot.codeOwner!==(vm.inspector??vm.image))throw new TypeError('Snapshot belongs to another code generation');
  for (const item of selected.fields) {
    if (!item.optional && !Object.hasOwn(snapshot, item.name))
      throw new TypeError(`Snapshot is missing '${item.name}'`);
  }
  validateSnapshotState(vm,snapshot,engine);
  vm.platform.hostOperations.checkRestore(snapshot.hostRevision);
  // Copy before changing the VM; the same memo preserves frame/fault aliases.
  const memo = new Map(), values = new Map();
  for (const item of selected.fields) {
    if (!Object.hasOwn(snapshot, item.name)) continue;
    const value = item.component
      ? item.name==='scheduler'?vm.scheduler.copySnapshot(snapshot.scheduler,memo):copyExecution(snapshot[item.name],memo)
      : item.copier(snapshot[item.name], memo);
    values.set(item.name, item.restore ? item.restore(value) : item.monotonic ? Math.max(vm[item.name], value) : value);
  }
  vm.heap.restore(values.get('heap'));
  for (const item of selected.fields) {
    if(item.component)continue;
    if (values.has(item.name)) vm[item.name] = values.get(item.name);
    else if (item.optional) delete vm[item.name];
  }
  if (engine === 'source') { vm.state = 'paused'; vm.currentPoint = vm.top?.point ?? null; }
  vm.scheduler.restore(values.get('scheduler'),memo,true);
  vm.platform.restore(values.get('platform'));
}
