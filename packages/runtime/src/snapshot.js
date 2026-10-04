import {captureGenericInstantiations, prepareGenericInstantiations} from './execution/generics.js';
import {invalidateExecutionCode} from './execution/code-version.js';
import {releaseAllFrames, rebuildFrameIndex} from './execution/frame-lifetimes.js';
import {rebuildStackBudget} from './execution/stack-budget.js';
import {clearFramePool} from './execution/frame-pool.js';
import {validateSnapshotState} from './snapshot-validation.js';
import {copyExecution, copyFrames} from './execution/execution-copy.js';
import {snapshotSchemaVersion, SnapshotVersionError} from './execution/snapshot-version.js';
export {copyExecution, copyFrames} from './execution/execution-copy.js';
export {snapshotSchemaVersion, SnapshotVersionError} from './execution/snapshot-version.js';

const field = (name, copier = copyExecution, options = {}) => Object.freeze({name, copier, ...options});
const component = name => field(name, null, {component: true});
const retain = value => value;
const entries = (value, memo) => copyExecution([...value], memo);
const common = [
  component('platform'), component('scheduler'), field('frames', copyFrames), component('heap'), component('sync'),
  field('typeObjects', copyExecution, {optional: true}),
  field('statics'), field('fault'), field('pendingFault'), field('state', retain),
  field('instructions', retain), field('elapsedMs', retain), field('frameId', retain, {monotonic: true}),
  field('memorySequence', retain, {optional: true, monotonic: true}),
  field('output'), field('outputCharacters', retain), field('returnValue'), field('exitCode', retain),
  field('writeRevision', retain), field('pendingWrite', copyExecution, {optional: true})
];
const exclusions = {
  options: 'Host configuration is retained by the owning VM.',
  profiler: 'Host observations are cumulative and do not rewind with guest execution.',
  snapshotOwner: 'Snapshots are scoped to their original VM instance.',
  onOutput: 'Host callback, retained across restore.',
  onException: 'Debugger callback, retained across restore.',
  onWrite: 'Debugger callback, retained across restore.',
  notifyWrite: 'Designer transaction callback override, retained across restore.',
  frameIndex: 'Derived index of active and parked frames, rebuilt after restore.',
  valueLayouts: 'Derived physical value layouts for immutable metadata.',
  stackBudget: 'Derived stack accounting, rebuilt from active and parked frames.',
  framePool: 'Cleared reusable execution storage; discarded on restore.',
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
  ], {
    image: 'Immutable bytecode for the current code generation.',
    builtinResults: 'VM-owned source contract return classifications; contains no managed values.'
  }),
  cil: schema('cil', [...common,
    field('strings'), field('initialized'),
    field('genericCacheKeys', copyExecution, {capture: captureGenericInstantiations}),
    field('stack', copyExecution, {optional: true}),
    field('currentPoint', copyExecution, {optional: true}),
    field('sourcePause', retain, {optional: true})
  ], {
    genericInstantiations: 'Derived generic cache, captured as portable genericCacheKeys.',
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
    snapshot[item.name] = item.capture ? item.capture(vm) : item.component
      ? item.name==='heap'?vm.heap.snapshot({memo}):['scheduler','sync'].includes(item.name)?vm[item.name].snapshot(memo):copyExecution(vm[item.name].snapshot(),memo)
      : item.copier(vm[item.name], memo);
  }
  if (engine === 'cil') snapshot.heapRevision = vm.heap.mutationRevision;
  return snapshot;
}

export function restoreVM(vm, snapshot, engine) {
  const selected = assertSnapshotFields(vm, engine);
  if (snapshot?.owner !== vm.snapshotOwner) throw new TypeError(`Snapshot belongs to another ${engine === 'cil' ? 'CIL' : 'source'} VM`);
  if (snapshot.schemaVersion !== selected.schemaVersion || snapshot.engine !== engine)
    throw new SnapshotVersionError(engine);
  if(snapshot.codeOwner!==(vm.inspector??vm.image))throw new TypeError('Snapshot belongs to another code generation');
  for (const item of selected.fields) {
    if (!item.optional && !Object.hasOwn(snapshot, item.name))
      throw new TypeError(`Snapshot is missing '${item.name}'`);
  }
  validateSnapshotState(vm,snapshot,engine);
  vm.platform.hostOperations.checkRestore(snapshot.hostRevision);
  const genericCache = engine === 'cil' ? prepareGenericInstantiations(vm, snapshot.genericCacheKeys) : null;
  // Copy before changing the VM; the same memo preserves frame/fault aliases.
  const memo = new Map(), values = new Map();
  for (const item of selected.fields) {
    if (!Object.hasOwn(snapshot, item.name)) continue;
    const value = item.component
      ? item.name==='scheduler'?vm.scheduler.copySnapshot(snapshot.scheduler,memo):copyExecution(snapshot[item.name],memo)
      : item.copier(snapshot[item.name], memo);
    values.set(item.name, item.restore ? item.restore(value) : item.monotonic ? Math.max(vm[item.name] ?? 0, value) : value);
  }
  releaseAllFrames(vm);
  clearFramePool(vm);
  vm.heap.restore(values.get('heap'),{memo,prepared:true});
  if (genericCache) vm.genericInstantiations = genericCache;
  for (const item of selected.fields) {
    if(item.component || item.capture)continue;
    if (values.has(item.name)) vm[item.name] = values.get(item.name);
    else if (item.optional) delete vm[item.name];
  }
  if (engine === 'source') { vm.state = 'paused'; vm.currentPoint = vm.top?.point ?? null; }
  // Reuse the memo mapping from the original snapshot to its prepared graph.
  // Passing the prepared sync value to restore would clone it a second time.
  vm.sync.restore(snapshot.sync,memo);
  vm.scheduler.restore(values.get('scheduler'),memo,true);
  vm.platform.restore(values.get('platform'));
  rebuildFrameIndex(vm);
  rebuildStackBudget(vm);
  invalidateExecutionCode(vm, 'restore');
}
