import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const source = `class Program {
  static void Child() { Console.Write("child"); }
  static void Parent() { Console.Write("before"); Child(); Console.Write("after"); }
  static void Main() { Parent(); }
}`;
function make(engine, options = {}, text = source) {
  const artifact = compileToIL(text);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
    : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, options);
}
function timed(engine, profile = {}, text = source) {
  let now = 0;
  const vm = make(engine, {profile: {duration: true, clock: () => now, ...profile},
    onOutput: text => { now += {before: 2, child: 7, after: 3, tick: 1}[text] ?? 0; }}, text);
  return {vm, advance: value => { now += value; }};
}
const named = (profile, name) => profile.methods.find(method => method.name.endsWith('.' + name) || method.name.endsWith('::' + name));
const sum = values => values.reduce((total, value) => total + value, 0);
function totals(profile, duration) {
  assert.equal(profile.format, 'SharpForge.InstructionProfile/1');
  assert.equal(profile.clock, 'instructions');
  assert.equal(profile.duration.totalMilliseconds, duration);
  assert.equal(sum(profile.methods.map(method => method.exclusiveMilliseconds)), duration);
  assert.equal(sum(profile.samples.map(sample => sample.milliseconds)), duration);
  assert.equal(sum(profile.methods.map(method => method.instructions)), profile.instructions);
  assert.equal(sum(profile.samples.map(sample => sample.weight)), profile.instructions);
}

for (const engine of ['source', 'reload', 'cil']) {
  for (const sampleBudget of [1, 2, 256]) test(`${engine}: duration budget ${sampleBudget} includes each final dispatched instruction`, () => {
    const {vm} = timed(engine, {sampleBudget});
    try {
      assert.equal(vm.run().output, 'beforechildafter');
      const profile = instructionProfile(vm), parent = named(profile, 'Parent'), child = named(profile, 'Child');
      totals(profile, 12);
      assert.equal(parent.exclusiveMilliseconds, 5);
      assert.equal(parent.inclusiveMilliseconds, 12);
      assert.equal(child.exclusiveMilliseconds, 7);
      assert.equal(child.inclusiveMilliseconds, 7);
    } finally { vm.stop(); }
  });

  test(`${engine}: default and explicitly disabled durations preserve the complete instruction-only view`, () => {
    const plain = make(engine, {profile: true});
    const disabled = make(engine, {profile: {duration: false, clock: () => { throw new Error('unused'); }}});
    const unspecified = make(engine, {profile: {clock: () => { throw new Error('unused'); }}});
    try {
      plain.run(); disabled.run(); unspecified.run();
      const expected = instructionProfile(plain);
      assert.equal(Object.hasOwn(expected, 'duration'), false);
      assert(expected.methods.every(method => !Object.hasOwn(method, 'exclusiveMilliseconds')));
      assert(expected.samples.every(sample => !Object.hasOwn(sample, 'milliseconds')));
      assert.deepEqual(instructionProfile(disabled), expected);
      assert.deepEqual(instructionProfile(unspecified), expected);
    } finally { plain.stop(); disabled.stop(); unspecified.stop(); }
  });

  test(`${engine}: host slice gaps and snapshot idle time do not become guest duration`, () => {
    const {vm, advance} = timed(engine, {sampleBudget: 1});
    try {
      for (let step = 0; step < 500 && vm.output.join('') !== 'before'; step++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
        advance(10000);
      }
      assert.equal(vm.output.join(''), 'before');
      const snapshot = vm.snapshot(), before = instructionProfile(vm);
      assert.equal(Object.hasOwn(snapshot, 'profiler'), false);
      assert.equal(Object.hasOwn(snapshot, 'options'), false);
      totals(before, 2);
      assert.equal(vm.run().output, 'beforechildafter');
      const first = instructionProfile(vm);
      totals(first, 12);
      advance(10000);
      vm.restore(snapshot);
      assert.deepEqual(instructionProfile(vm), first);
      assert.equal(vm.run().output, 'beforechildafter');
      totals(instructionProfile(vm), 22);
      vm.stop();
      advance(10000);
      totals(instructionProfile(vm), 22);
    } finally { vm.stop(); }
  });

  test(`${engine}: recursion and stack capacity overflow retain complete exclusive duration`, () => {
    const text = `class Program { static void Recur(int n) { if (n > 1) Recur(n - 1); Console.Write("tick"); }
      static void Main() { Recur(3); } }`;
    const {vm} = timed(engine, {maxStacks: 2}, text);
    try {
      assert.equal(vm.run().output, 'tickticktick');
      const profile = instructionProfile(vm), method = named(profile, 'Recur');
      totals(profile, 3);
      assert.equal(method.exclusiveMilliseconds, 3);
      assert.equal(method.inclusiveMilliseconds, 6);
      assert.equal(profile.samples.length, 2);
      assert(profile.overflow.stackMilliseconds > 0);
    } finally { vm.stop(); }
  });

  test(`${engine}: malformed duration options fail explicitly`, () => {
    for (const duration of [null, 1, 'true']) assert.throws(() => make(engine, {profile: {duration}}), TypeError);
    for (const clock of [null, 1, 'clock', {}]) assert.throws(() => make(engine, {profile: {duration: true, clock}}), TypeError);
  });

  test(`${engine}: clock callback failure stays outside guest dispatch and stop still cleans up`, () => {
    const failure = new Error('host clock failed');
    const vm = make(engine, {profile: {duration: true, clock: () => { throw failure; }}});
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.output.join(''), 'beforechildafter');
    assert.equal(vm.fault, null);
    assert.throws(() => instructionProfile(vm), error => error === failure);
    assert.throws(() => vm.stop(), error => error === failure);
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.state, 'terminated');
  });
}

test('CIL: manual steps close intervals before control returns to the host', () => {
  const {vm, advance} = timed('cil', {sampleBudget: 256});
  try {
    while (vm.frames.length) {
      vm.step();
      advance(10000);
    }
    totals(instructionProfile(vm), 12);
    assert.equal(vm.output.join(''), 'beforechildafter');
  } finally { vm.stop(); }
});

test('CIL: non-finite, negative and regressing clock values are rejected at the host boundary', () => {
  for (const values of [[NaN], [Infinity], [-1], ['1'], [10, 9]]) {
    let index = 0;
    const vm = make('cil', {profile: {duration: true, sampleBudget: 1,
      clock: () => values[Math.min(index++, values.length - 1)]}});
    assert.throws(() => vm.run(), /monotonic/);
    assert.equal(vm.fault, null);
    assert.throws(() => vm.stop(), /monotonic/);
    assert.equal(vm.frames.length, 0);
  }
});

test('CIL: an existing guest exception remains visible when the host clock also fails', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body: writer => writer.op('ldnull').op('throw')}]});
  const vm = new CilVirtualMachine(assembly, {profile: {duration: true, clock: () => NaN}});
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'NullReferenceException');
  assert.throws(() => instructionProfile(vm), /monotonic/);
  assert.doesNotThrow(() => vm.stop());
  assert.equal(vm.frames.length, 0);
});

test('CIL: stop preserves a debugger-pending guest exception while cleaning up a failed clock', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body: writer => writer.op('ldnull').op('throw')}]});
  const vm = new CilVirtualMachine(assembly, {
    profile: {duration: true, clock: () => NaN}
  });
  vm.onException = () => true;
  assert.equal(vm.run().state, 'paused');
  assert.equal(vm.pendingFault.name, 'NullReferenceException');
  assert.throws(() => instructionProfile(vm), /monotonic/);
  assert.doesNotThrow(() => vm.stop());
  assert.equal(vm.frames.length, 0);
  assert.equal(vm.state, 'terminated');
});

test('CIL: parked delegate duration excludes virtual waiting and host delay', () => {
  const assembly = managedFixture({methods: [
    {name: 'Main', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker)
        .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
        .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
        .op('pop').op('ret');
    }},
    {name: 'Worker', body(writer, context) {
      const write = context.member('System.Console', 'Write', 'void', ['string']);
      writer.op('ldstr', 0x70000000 + context.md.userString('before')).op('call', write);
      writer.op('ldc.i4', 60000).op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int']));
      writer.op('ldstr', 0x70000000 + context.md.userString('after')).op('call', write).op('ret');
    }}
  ]});
  let now = 0;
  const vm = new CilVirtualMachine(assembly, {virtualTime: true,
    profile: {duration: true, clock: () => now}, onOutput: () => { now += 2; }});
  try {
    assert.equal(vm.run().state, 'waiting');
    totals(instructionProfile(vm), 2);
    now += 60000;
    vm.scheduler.advance(60000);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.output.join(''), 'beforeafter');
    totals(instructionProfile(vm), 4);
  } finally { vm.stop(); }
});
