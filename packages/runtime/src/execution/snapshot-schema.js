import {copyExecution, copyFrames} from './execution-copy.js';
import {snapshotSchemaVersion} from './snapshot-version.js';

const field = (name, copier = copyExecution, options = {}) => Object.freeze({name, copier, ...options});
const component = name => field(name, null, {component: true, optional: name === 'sync'});
const retain = value => value;
const entries = (value, memo) => copyExecution([...value], memo);
const common = [
  component('heap'), field('frames', copyFrames), component('scheduler'), component('platform'),
  component('sync'), field('memorySequence', retain, {optional: true, monotonic: true}),
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
  ], {
    image: 'Immutable bytecode for the current code generation.',
    builtinResults: 'VM-owned source contract return classifications; contains no managed values.'
  }),
  cil: schema('cil', [...common,
    field('strings'), field('initialized'),
    field('genericCacheKeys', copyExecution, {capture: true}),
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

