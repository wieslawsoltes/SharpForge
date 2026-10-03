import {fail} from '../host.js';

const owner = 'System.Random';
const maximum = 2147483647;

function contracts({define, ctor, prop, member}) {
  define(owner, {kind: 'bcl14', family: 'random'});
  ctor(owner);
  ctor(owner, ['int']);
  prop(owner, 'Shared', owner, null, true, true);
  for (const parameters of [[], ['int'], ['int', 'int']]) {
    member(owner, 'Next', parameters, 'int');
  }
  member(owner, 'NextDouble', [], 'double');
}

function create(p, type, seed) {
  const subtraction = seed === -2147483648 ? maximum : Math.abs(seed);
  let previous = 161803398 - subtraction;
  let next = 1;
  const values = Array(56).fill(0);
  values[55] = previous;
  for (let index = 1; index < 55; index++) {
    const target = (21 * index) % 55;
    values[target] = next;
    next = previous - next;
    if (next < 0) next += maximum;
    previous = values[target];
  }
  for (let pass = 1; pass < 5; pass++) {
    for (let index = 1; index < 56; index++) {
      values[index] -= values[1 + (index + 30) % 55];
      if (values[index] < 0) values[index] += maximum;
    }
  }
  const data = p.heap.allocate('array', 'int[]', values);
  return p.heap.withRoots([data], () => p.make(type, {'$data': data, '$i': 0, '$j': 21}));
}

function sample(p, reference, record) {
  let first = p.get(reference, '$i') + 1;
  let second = p.get(reference, '$j') + 1;
  if (first >= 56) first = 1;
  if (second >= 56) second = 1;
  let value = record.data[first] - record.data[second];
  if (value === maximum) value--;
  if (value < 0) value += maximum;
  record.data[first] = value;
  p.set(reference, '$i', first);
  p.set(reference, '$j', second);
  return value;
}

function next(p, reference, record, native) {
  if (native.length === 1) return sample(p, reference, record);
  const minimum = native.length === 2 ? 0 : native[1];
  const maximumValue = native.length === 2 ? native[1] : native[2];
  if (minimum > maximumValue || maximumValue < 0 && native.length === 2) {
    fail(p, 'ArgumentOutOfRangeException', 'Invalid random range');
  }
  const span = maximumValue - minimum;
  let value;
  if (span <= maximum) {
    value = sample(p, reference, record) / maximum;
  } else {
    let signed = sample(p, reference, record);
    if (sample(p, reference, record) % 2 === 0) signed = -signed;
    value = (signed + 2147483646) / 4294967293;
  }
  return Math.floor(value * span) + minimum;
}

function invoke(p, descriptor, args, type = p.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl14' || type.family !== 'random') return {handled: false};
  const native = args.map(value => p.native(value));
  if (descriptor.kind === 'constructor') {
    return {handled: true, value: create(p, descriptor.owner, args.length ? native[0] : Date.now() | 0)};
  }
  if (descriptor.isStatic) {
    const value = p.singleton('Random.Shared', () => create(p, descriptor.owner, Date.now() | 0));
    return {handled: true, value};
  }
  const reference = args[0];
  const record = p.heap.get(p.get(reference, '$data'));
  const value = descriptor.name === 'NextDouble'
    ? p.managed(sample(p, reference, record) / maximum, 'double')
    : next(p, reference, record, native);
  return {handled: true, value};
}

/** Released Random contracts and seeded subtractive generator with heap-owned snapshot state. */
export const randomModule = Object.freeze({name: 'random', families: ['random'], contracts, invoke});
