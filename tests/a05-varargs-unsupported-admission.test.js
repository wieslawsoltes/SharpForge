import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

function fixture({kind = 'pinvoke', optional = true, mismatch = false, convention = 5} = {}) {
  const external = kind === 'external';
  const signature = Uint8Array.from([convention, 1, 8, 8]);
  return controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      const owner = external ? context.resolve('Native.Library') : context.methods.get('Program.Write');
      const callSignature = optional ? Uint8Array.from([convention, 2, 8,
        ...(mismatch ? [0x41, 8, 8] : [8, 0x41, 8])]) : signature;
      const target = !external && !optional ? owner : context.md.member(owner, 'Write', callSignature);
      writer.op('ldc.i4', 42);
      if (optional) writer.op('ldc.i4.7');
      writer.op('call', target).op('ret');
    }},
    ...(!external ? [{name: 'Write', result: 'int', parameters: ['int'], signature,
      flags: kind === 'pinvoke' ? 0x2096 : 0x96,
      implFlags: kind === 'native' ? 1 : 0,
      ...(kind === 'managed' ? {body: writer => writer.op('ldarg.0').op('ret')} : {})}] : [])
  ]}], {decorate(context) {
    if (kind !== 'pinvoke') return;
    const module = context.md.add(26, [context.md.string('unavailable-native-library')]);
    context.md.add(28, [0x200, codedIndex('MemberForwarded', context.methods.get('Program.Write')),
      context.md.string('native_write'), module & 0xffffff]);
  }});
}

for (const kind of ['external', 'pinvoke', 'native']) {
  for (const optional of [false, true]) test(`${kind} vararg admission retains member and unsupported convention (${optional})`, () => {
    const bytes = fixture({kind, optional});
    const inspector = new AssemblyInspector(bytes);
    const expectedMember = (kind === 'external' ? 'Native.Library' : 'Program') + '::Write';
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, false);
    const unsupported = report.issues.find(issue => issue.code === 'IL_UNMANAGED');
    assert(unsupported, JSON.stringify(report.issues));
    assert.equal(unsupported.exceptionType, 'NotSupportedException');
    assert.equal(unsupported.member, expectedMember);
    assert.equal(unsupported.callingConvention, 5);
    assert.match(unsupported.message, /Write/);
    assert.equal(unsupported.method, 'Program::Main', 'The rejected call retains its caller and instruction location');
    assert.equal(typeof unsupported.offset, 'number');
    assert.throws(() => new CilVirtualMachine(inspector), error => {
      assert.equal(error.name, 'NotSupportedException');
      assert.equal(error.member, expectedMember);
      assert.equal(error.callingConvention, 5);
      assert.match(error.message, /Write/);
      return true;
    });
  });
}

test('a non-vararg unmanaged call convention retains its structured diagnostic', () => {
  const bytes = fixture({kind: 'external', optional: false, convention: 1});
  assert.throws(() => new CilVirtualMachine(bytes), error => error.name === 'NotSupportedException' &&
    error.member === 'Native.Library::Write' && error.callingConvention === 1);
});

for (const optional of [false, true]) test(`managed varargs remain executable with optional arguments=${optional}`, () => {
  const vm = new CilVirtualMachine(fixture({kind: 'managed', optional}));
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 42);
  } finally { vm.stop(); }
});

test('a malformed managed fixed signature remains invalid, not unsupported', () => {
  const bytes = fixture({kind: 'managed', mismatch: true});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /Vararg fixed signature mismatch/.test(issue.message)));
  assert.equal(report.issues.some(issue => issue.exceptionType === 'NotSupportedException'), false);
  assert.throws(() => new CilVirtualMachine(bytes), error => error.name === 'CilError' && /Vararg fixed signature mismatch/.test(error.message));
});
