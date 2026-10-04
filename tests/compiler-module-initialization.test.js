import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, verifyCilAssembly, verifiedStackBound } from '@sharpforge/cil';
import { compile, compileToAssembly, compileToIL } from '@sharpforge/compiler';
import { CilVirtualMachine, VirtualMachine } from '@sharpforge/runtime';
import { fixtures } from '../packages/compiler/test/differential/fixtures/module-initialization.js';
import { managedFixture } from './managed-fixtures.js';
import { registerCompilerReferenceTests } from './support/compiler-pinned-reference.js';

const baseline = 'module initialization baseline';
const expectedOutputs = new Map([
  ['plain-main', 'module\nmain\n'],
  ['static-field-main', 'module\nfield\n42\n'],
  ['static-constructor-main', 'module\ntype\nmain\n'],
  ['initializer-calls-entry-type', 'module-start\ntype\n42\nmodule-end\n42\n'],
  ['declaration-order-once', '1\n2\n3\n3\n3\n'],
  ['pre-entry-fault', 'module\n'],
  ['no-initializers', 'main\n'],
]);
const librarySource = readFileSync(new URL('./fixtures/module-initialization/Library.cs', import.meta.url), 'utf8');
const source = name => fixtures.find(fixture => fixture.id === `module-initialization/${name}`).source;

function emit(text, options = {}) {
  const result = compileToAssembly(text, { name: 'ModuleInitialization', ...options });
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
  assert.ok(result.assembly);
  return result.assembly;
}

function withVM(assembly, options, action) {
  const vm = new CilVirtualMachine(assembly, options);
  try { return action(vm); }
  finally { vm.stop(); }
}

function moduleType(inspector) {
  return inspector.types.find(type => type.name === '<Module>');
}

function calls(inspector, method) {
  return inspector.getMethod(method.token).instructions
    .filter(instruction => instruction.name === 'call')
    .map(instruction => inspector.resolveToken(instruction.operand))
    .map(target => `${target.owner}::${target.name}`);
}

for (const name of ['plain-main', 'static-field-main', 'static-constructor-main', 'initializer-calls-entry-type']) {
  test(`${baseline}: producer emits a module constructor for ${name}`, () => {
    const inspector = new AssemblyInspector(emit(source(name)));
    const constructors = moduleType(inspector).methods;
    assert.deepEqual(constructors.map(method => method.name), ['.cctor']);
    const initializer = inspector.getMethod(constructors[0].token);
    assert.equal(initializer.signature.isStatic, true);
    assert.equal(initializer.signature.returnType, 'void');
    assert.deepEqual(initializer.signature.parameters, []);
    assert.equal(initializer.flags & 0x1800, 0x1800, 'special-name constructor flags');
    assert.deepEqual(calls(inspector, initializer), ['Startup::Initialize']);
    const entry = inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Main');
    assert.ok(!calls(inspector, entry).includes('Startup::Initialize'), 'Main must not own module startup');
  });
}

for (const fixture of fixtures) {
  const name = fixture.id.split('/')[1];
  test(`${baseline}: direct CIL startup for ${name}`, () => {
    withVM(emit(fixture.source), {}, vm => {
      const result = vm.run();
      assert.equal(result.output, expectedOutputs.get(name));
      if (name === 'pre-entry-fault') {
        assert.equal(result.state, 'faulted');
        assert.equal(result.fault?.name, 'TypeInitializationException');
        assert.equal(result.fault?.typeName, '<Module>');
      } else {
        assert.equal(result.state, 'terminated', result.fault?.stack);
      }
    });
  });
}

test(`${baseline}: a library owns module startup before a selected static method`, () => {
  const assembly = emit(librarySource, { outputKind: 'library' });
  const inspector = new AssemblyInspector(assembly);
  const initializer = moduleType(inspector).methods.find(method => method.name === '.cctor');
  assert.ok(initializer, 'libraries need the same module constructor as executables');
  assert.deepEqual(calls(inspector, initializer), ['Export::First', 'Export::Second']);
  withVM(assembly, { methodToken: 'Read' }, vm => {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'first\nsecond\nread\n');
    assert.equal(result.returnValue, 2);
  });
});

const orderedFiles = [
  { uri: 'Beta.cs', text: `using System; class Beta {
    [System.Runtime.CompilerServices.ModuleInitializer] public static void Initialize() { Console.WriteLine("beta"); }
  }` },
  { uri: 'Alpha.cs', text: `using System; class Alpha {
    [System.Runtime.CompilerServices.ModuleInitializer] public static void Initialize() { Console.WriteLine("alpha"); }
  }` },
  { uri: 'Program.cs', text: 'using System; class Program { static void Main() { Console.WriteLine("main"); } }' },
];

test(`${baseline}: module constructor preserves source declaration order across files`, () => {
  const assembly = emit(orderedFiles);
  const inspector = new AssemblyInspector(assembly);
  const initializer = moduleType(inspector).methods.find(method => method.name === '.cctor');
  assert.ok(initializer);
  assert.deepEqual(calls(inspector, initializer), ['Beta::Initialize', 'Alpha::Initialize']);
  withVM(assembly, {}, vm => assert.equal(vm.run().output, 'beta\nalpha\nmain\n'));
});

test(`${baseline}: no initializer leaves the module empty`, () => {
  for (const text of [source('no-initializers'), 'class Program { static Program() { } static void Main() { } }']) {
    const assembly = emit(text);
    assert.deepEqual(moduleType(new AssemblyInspector(assembly)).methods, []);
    withVM(assembly, {}, vm => assert.equal(vm.run().state, 'terminated'));
  }
});

// These fixtures author an actual <Module> MethodDef independently of the C# producer.
function moduleAssembly({ initializer, methods, fields = [], library = false }) {
  return managedFixture({
    name: 'ModuleLifecycle',
    entry: library ? null : 1,
    fields,
    methods: [{ name: '.cctor', flags: 0x1891, body: initializer }, ...methods],
    decorate({ md }) {
      // Both TypeDefs initially begin at method 1; move Program's start after the module method.
      md.rows[2][1][5] = 2;
    },
  });
}

function lifecycleAssembly(library = false) {
  return moduleAssembly({
    library,
    fields: [{ name: 'Count' }, { name: 'Payload', type: 'object' }],
    initializer(writer, context) {
      writer.op('newobj', context.member('System.Object', '.ctor', 'void', [], false));
      writer.op('stsfld', context.fields.Payload);
      writer.op('ldsfld', context.fields.Count).op('ldc.i4.1').op('add').op('stsfld', context.fields.Count);
      writer.op('ret');
    },
    methods: [{ name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldsfld', context.fields.Count).op('ret');
    } }],
  });
}

for (const library of [false, true]) {
  test(`${baseline}: independent CIL module startup is verified and runs once (${library ? 'library' : 'entry'})`, () => {
    const assembly = lifecycleAssembly(library);
    const inspector = new AssemblyInspector(assembly);
    const module = moduleType(inspector);
    const options = library ? { methodToken: 'Main' } : {};
    const report = verifyCilAssembly(inspector, options);
    assert.equal(report.success, true, JSON.stringify(report.issues));
    assert.ok(report.methods.includes(module.methods[0].token), 'module constructor is a mandatory verification root');
    assert.ok(verifiedStackBound(inspector, report, inspector.getMethod(module.methods[0].token)));
    withVM(inspector, options, vm => {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 1);
      assert.equal(vm.initialized.get(module.token)?.status, 'initialized');
      assert.equal(vm.ensureInitialized(module.token, 'static-method'), false);
      const count = [...inspector.fields.values()].find(field => field.name === 'Count');
      assert.equal(vm.value(vm.statics.get(count.token)), 1);
    });
  });
}

test(`${baseline}: an active module initializer survives snapshot restore and collection`, () => {
  withVM(lifecycleAssembly(), {}, vm => {
    const module = moduleType(vm.inspector);
    const payload = [...vm.inspector.fields.values()].find(field => field.name === 'Payload');
    const beforeStartup = vm.snapshot();
    for (let remaining = 64; remaining > 0 && vm.statics.get(payload.token) === null; remaining--) {
      if (!vm.top || vm.state === 'faulted' || vm.state === 'terminated') break;
      vm.runSlice({ instructionBudget: 1, timeBudgetMs: Infinity });
    }
    assert.equal(vm.top?.method.owner, '<Module>', 'pause after the module stores its managed reference');
    assert.equal(vm.initialized.get(module.token)?.status, 'initializing');
    const active = vm.snapshot();
    const assertComplete = () => {
      const reference = vm.statics.get(payload.token);
      assert.ok(reference);
      vm.heap.collect();
      assert.equal(vm.heap.get(reference).type, 'System.Object');
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 1);
      assert.equal(vm.initialized.get(module.token)?.status, 'initialized');
    };
    assertComplete();
    vm.restore(active);
    assertComplete();
    vm.restore(beforeStartup);
    vm.heap.collect();
    assert.equal(vm.run().returnValue, 1);
    assert.equal(vm.initialized.get(module.token)?.status, 'initialized');
  });
});

function failingModuleAssembly() {
  return moduleAssembly({
    initializer(writer, context) {
      writer.op('ldstr', 0x70000000 + context.md.userString('module cause'));
      writer.op('newobj', context.member('System.Exception', '.ctor', 'void', ['string'], false)).op('throw');
    },
    methods: [{ name: 'Main', body(writer, context) {
      const print = text => writer.op('ldstr', 0x70000000 + context.md.userString(text))
        .op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
      writer.mark('try');
      print('main');
      writer.op('leave', 'done').mark('catch').op('pop');
      print('caught');
      writer.op('leave', 'done').mark('done').op('ret');
    }, handlers(labels, context) {
      return [{ start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
        handlerEnd: labels.get('done'), catchType: context.resolve('System.Exception') }];
    } }],
  });
}

test(`${baseline}: pre-entry failure bypasses Main catch and stays cached, rooted, and restorable`, () => {
  withVM(failingModuleAssembly(), {}, vm => {
    const module = moduleType(vm.inspector);
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.output, '', 'neither Main nor its catch handler has begun');
    assert.equal(result.fault?.name, 'TypeInitializationException');
    assert.equal(result.fault?.typeName, '<Module>');
    assert.equal(vm.initialized.get(module.token)?.status, 'failed');
    const snapshot = vm.snapshot();
    const assertCached = () => {
      const fault = vm.initialized.get(module.token).fault;
      assert.equal(vm.fault, fault);
      assert.equal(fault.innerException.message, 'module cause');
      vm.heap.collect();
      assert.ok(vm.heap.get(fault.reference));
      assert.ok(vm.heap.get(fault.innerException.reference));
      assert.throws(() => vm.ensureInitialized(module.token, 'static-method'), error => error === fault);
    };
    assertCached();
    vm.restore(snapshot);
    assertCached();
  });
});

for (const library of [false, true]) {
  test(`${baseline}: an invalid module body is rejected before ${library ? 'selected method' : 'entry'} execution`, () => {
    const assembly = moduleAssembly({ library,
      initializer: writer => writer.op('pop').op('ret'),
      methods: [{ name: 'Main', body: writer => writer.op('ret') }],
    });
    const inspector = new AssemblyInspector(assembly);
    const initializer = moduleType(inspector).methods[0];
    const options = library ? { methodToken: 'Main' } : {};
    const report = verifyCilAssembly(inspector, options);
    assert.equal(report.success, false, 'module startup must not bypass verifier admission');
    assert.ok(report.issues.some(issue => issue.methodToken === initializer.token && issue.code === 'IL_STACK'));
    assert.throws(() => new CilVirtualMachine(inspector, options), error =>
      error.issues?.some(issue => issue.methodToken === initializer.token && issue.code === 'IL_STACK'));
  });
}

test(`${baseline}: an unrelated unreachable invalid body is not a module initialization root`, () => {
  const assembly = managedFixture({ methods: [
    { name: 'Main', result: 'int', body: writer => writer.op('ldc.i4', 7).op('ret') },
    { name: 'Unreachable', body: writer => writer.op('pop').op('ret') },
  ] });
  const inspector = new AssemblyInspector(assembly);
  assert.deepEqual(moduleType(inspector).methods, []);
  const unreachable = [...inspector.methods.values()].find(method => method.name === 'Unreachable');
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  assert.ok(!report.methods.includes(unreachable.token));
  withVM(inspector, {}, vm => assert.equal(vm.run().returnValue, 7));
});

// The legacy image startup path is an independent control, never evidence for direct-CIL module startup.
for (const [name, compiler] of [['compile', compile], ['compileToIL', compileToIL]]) {
  test(`${baseline}: ${name} source-image startup remains a separate control`, () => {
    const result = compiler(orderedFiles, { includeDebug: false, portablePdb: false });
    assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error'), []);
    assert.ok(result.image);
    const vm = new VirtualMachine(result.image);
    try {
      const run = vm.run();
      assert.equal(run.state, 'terminated', run.fault?.stack);
      assert.equal(run.output, 'beta\nalpha\nmain\n');
    } finally { vm.stop(); }
  });
}

registerCompilerReferenceTests('module initialization', fixtures);
