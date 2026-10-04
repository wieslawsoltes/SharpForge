import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, VirtualPointerProfile, codedIndex, encodeSignature, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const primitive = name => ({kind: 'primitive', name});
const signature = options => ({kind: 'method', hasThis: true, returnType: primitive('int'), parameters: [], ...options});
const standalone = context => context.md.add(17, [context.md.blob(encodeSignature(signature()))]);
const constructor = base => ({name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
  const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
  writer.op('ldarg.0').op('call', target).op('ret');
}});
const method = (value, flags, name = 'Get') => ({name, flags, static: false, result: 'int',
  body: writer => writer.op('ldc.i4', value).op('ret')});

function fixture({capture = 'Derived', receiver = 'Derived', abstract = false, inherited = false, newslot = false,
  explicit = false, final = false, memberRef = false, loop = false, badOverride = false, customize, main} = {}) {
  const declaration = abstract ? {name: 'Get', static: false, flags: 0x5c6, result: 'int'} : method(7, 0x1c6 | (final ? 0x20 : 0));
  const override = method(42, explicit ? 0xc1 : 0xc6 | (newslot ? 0x100 : 0), explicit ? 'Selected' : 'Get');
  if (badOverride) override.body = writer => writer.op('pop').op('ldc.i4.0').op('ret');
  const types = [
    {name: 'Base', flags: 0x100001 | (abstract ? 0x80 : 0), methods: [constructor(), declaration]},
    {name: 'Derived', base: 'Base', methods: [constructor('Base'), ...(inherited ? [] : [override])]},
    {name: 'Other', methods: [constructor()]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['Base', 'nint', 'Base', 'int'], body(writer, context) {
      if (main) { main(writer, context); return; }
      writer.op('newobj', context.methods.get(capture + '..ctor')).op('stloc.0');
      writer.op('newobj', context.methods.get(receiver + '..ctor')).op('stloc.2');
      const target = memberRef ? context.member('Base', 'Get', 'int', [], false) : context.methods.get('Base.Get');
      writer.mark('again').op('ldloc.0').op('ldvirtftn', target).op('stloc.1');
      if (loop) writer.op('ldloc.3').op('ldc.i4.1').op('add').op('stloc.3')
        .op('ldloc.3').op('ldc.i4.2').op('blt.s', 'again');
      writer.op('ldloc.2').op('ldloc.1').op('calli', standalone(context)).op('ret');
    }}]}
  ];
  customize?.(types);
  return genericCallFixture(types, {decorate(context) {
    if (explicit) context.md.add(25, [context.types.get('Derived') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Derived.Selected')),
      codedIndex('MethodDefOrRef', context.methods.get('Base.Get'))]);
  }});
}

function withVM(bytes, callback, options = {}) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pause(vm, predicate = instruction => instruction.name === 'ldvirtftn') {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction: predicate});
  assert.equal(vm.state, 'paused');
}

for (const nativeIntBits of [32, 64]) for (const inlineCaches of [false, true]) {
  test(`ldvirtftn captures the override with ABI${nativeIntBits}, PIC ${inlineCaches}`, () => {
    withVM(fixture({loop: true}), vm => {
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 42);
    }, {nativeIntBits, inlineCaches});
  });
}

for (const [options, expected] of [
  [{capture: 'Base'}, 7], [{inherited: true}, 7], [{newslot: true}, 7],
  [{explicit: true}, 42], [{abstract: true}, 42], [{memberRef: true}, 42], [{final: true, inherited: true}, 7]
]) test(`virtual pointer slot selection ${JSON.stringify(options)}`, () => {
  withVM(fixture(options), vm => {
    const report = vm.report;
    if (options.abstract) {
      const declaration = [...vm.inspector.methods.values()].find(method => method.owner === 'Base' && method.name === 'Get');
      assert.equal(report.methods.includes(declaration.token), false, 'abstract declaration is not an executable body');
    }
    assert.equal(vm.run().returnValue, expected,
      'calli invokes the captured body even when the subsequent explicit receiver has an overriding runtime type');
  });
});

test('verification follows unallocated override bodies, with a bounded cached metadata traversal', () => {
  const bytes = fixture({capture: 'Base', receiver: 'Base', badOverride: true});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.method === 'Derived::Get' && issue.code === 'IL_STACK'), JSON.stringify(report.issues));
  const inspector = new AssemblyInspector(fixture());
  const declaration = [...inspector.methods.values()].find(method => method.owner === 'Base' && method.name === 'Get');
  const profile = new VirtualPointerProfile(inspector);
  const first = profile.reachable(declaration.token), work = profile.work;
  assert.equal(first.length, 2);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(profile.reachable(declaration.token), first);
  assert.equal(profile.work, work, 'warm metadata queries do no new hierarchy work');
});

test('invalid final overrides are rejected through the existing dispatch rules', () => {
  const report = verifyCilAssembly(fixture({final: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /final virtual/.test(issue.message)));
});

for (const warm of [false, true]) test(`ownership, liveness and compatibility precede pops on ${warm ? 'warm' : 'cold'} sites`, () => {
  const bytes = fixture({loop: true});
  withVM(bytes, vm => withVM(bytes, foreign => {
    pause(vm); pause(foreign);
    if (warm) { vm.step(); vm.state = 'running'; pause(vm); }
    const original = vm.top.stack.at(-1), snapshot = vm.snapshot();
    const wrong = vm.heap.object(vm.typeSystem.table('Other'), []);
    const cases = [[null, 'NullReferenceException'], [undefined, 'InvalidProgramException'], [123, 'InvalidProgramException'],
      [foreign.top.stack.at(-1), 'InvalidProgramException'], [Object.freeze({...original}), 'InvalidProgramException'],
      [wrong, 'InvalidProgramException']];
    for (const [receiver, name] of cases) {
      vm.top.stack[vm.top.stack.length - 1] = receiver;
      const stack = [...vm.top.stack], pc = vm.top.pc;
      assert.throws(() => vm.step(), {name});
      assert.deepEqual(vm.top.stack, stack);
      vm.top.pc = pc;
    }
    vm.restore(snapshot);
    const stale = vm.heap.object(vm.typeSystem.table('Base'), []);
    vm.heap.collect();
    vm.top.stack[vm.top.stack.length - 1] = stale;
    const stack = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidReferenceException'});
    assert.deepEqual(vm.top.stack, stack);
  }));
});

test('pointer capture does not retain its receiver; the explicit calli receiver remains rooted', () => {
  withVM(fixture(), vm => {
    pause(vm, instruction => instruction.name === 'calli');
    const captured = vm.top.locals[0], receiver = vm.top.locals[2];
    vm.top.locals[0] = null;
    vm.top.locals[2] = null;
    vm.heap.collect();
    assert.throws(() => vm.heap.get(captured), {name: 'InvalidReferenceException'});
    assert.equal(vm.heap.get(receiver).type, 'Derived');
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
  });
});

for (const phase of ['capture', 'calli', 'body']) test(`snapshot, invalidation and stop preserve captured identity at ${phase}`, () => {
  const bytes = fixture({abstract: true});
  withVM(bytes, vm => {
    pause(vm, (instruction, frame) => phase === 'body' ? frame.method.name === 'Get'
      : instruction.name === (phase === 'capture' ? 'ldvirtftn' : 'calli'));
    const snapshot = vm.snapshot(), receiver = vm.frames[0].locals[2];
    for (let index = 0; index < 2; index++) {
      vm.restore(snapshot);
      invalidateExecutionCode(vm, 'virtual-pointer-replay');
      assert.equal(vm.frames[0].locals[2], receiver);
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 42);
    }
    vm.restore(snapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
  });
});

test('metadata replacement rebuilds receiver headers and the virtual-pointer epoch cache', () => {
  const bytes = fixture();
  withVM(bytes, vm => {
    pause(vm);
    vm.inspector = new AssemblyInspector(bytes);
    vm.report = verifyCilAssembly(vm.inspector);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
  });
});

for (const [label, customize] of [
  ['static', types => { types[0].methods[1].static = true; types[0].methods[1].flags = 0x96; }],
  ['nonvirtual', types => { types[0].methods[1].flags = 0x86; }],
  ['value', types => { types[0].base = 'System.ValueType'; }],
  ['interface', types => { types[0].interface = true; types[0].flags = 0xa1; }],
  ['generic owner', types => { types[0].genericParameters = [{}]; }],
  ['generic method', types => { types[0].methods[1].genericParameters = [{}]; }],
  ['external base', types => { types[0].base = 'System.Exception'; }],
  ['ExplicitThis', types => { types[0].methods[1].signature = encodeSignature(signature({explicitThis: true})); }]
]) test(`${label} virtual-pointer declarations remain outside the admitted scope`, () => {
  const report = verifyCilAssembly(fixture({customize}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_TOKEN'));
});

test('the ldvirtftn receiver is required by stack verification', () => {
  const report = verifyCilAssembly(fixture({main(writer, context) {
    writer.op('ldvirtftn', context.methods.get('Base.Get')).op('pop').op('ldc.i4.0').op('ret');
  }}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_STACK' && /underflow/.test(issue.message)));
});

test('metadata slot work cap rejects excessive breadth before virtual table construction', () => {
  const bytes = fixture({customize(types) {
    for (let index = 0; index < 520; index++) types[0].methods.push(method(index, 0x1c6, 'Slot' + index));
  }});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /ldvirtftn metadata work budget/.test(issue.message)));
});

test('a captured derived override cannot be called with only a base-class receiver', () => {
  withVM(fixture({receiver: 'Base'}), vm => {
    pause(vm, instruction => instruction.name === 'calli');
    const stack = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
    assert.deepEqual(vm.top.stack, stack);
  });
});

test('removed verified-target membership rejects capture before removing the receiver', () => {
  withVM(fixture(), vm => {
    pause(vm);
    const target = [...vm.inspector.methods.values()].find(method => method.owner === 'Derived' && method.name === 'Get').token;
    vm.report = {...vm.report, methods: vm.report.methods.filter(token => token !== target)};
    const stack = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
    assert.deepEqual(vm.top.stack, stack);
  });
});

test('abstract declarations without a concrete implementation fail verification', () => {
  const report = verifyCilAssembly(fixture({abstract: true, inherited: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_TOKEN' && /selected body/.test(issue.message)));
});

test('external virtual declarations remain outside the profile', () => {
  const report = verifyCilAssembly(fixture({main(writer, context) {
    writer.op('ldnull').op('ldvirtftn', context.member('System.Object', 'ToString', 'string', [], false))
      .op('pop').op('ldc.i4.0').op('ret');
  }}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_TOKEN' && /External/.test(issue.message)));
});

test('deep class ancestry cannot bypass the depth limit through previously cached parents', () => {
  const bytes = fixture({customize(types) {
    let base = 'Derived';
    for (let index = 0; index < 64; index++) {
      const name = 'Layer' + index;
      types.push({name, base, methods: []});
      base = name;
    }
  }});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /ldvirtftn class hierarchy depth/.test(issue.message)));
});
