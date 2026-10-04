import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, verifyCilMethodTypes, verifyCilAssembly } from '@sharpforge/cil';
import { numericCases, numericFixture } from './fixtures/verifier-numeric/input.js';
import { managedFixture } from './managed-fixtures.js';

const token = 0x06000001;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = (fixture, options) => verifyCilMethodTypes(numericFixture(fixture), token, options);

test('typed numeric corpus follows ECMA operand, storage and branch tables', () => {
  assert.ok(numericCases.length >= 60);
  for (const fixture of numericCases) {
    const report = verify(fixture);
    assert.equal(report.status, fixture.accepted ? 'verified' : 'rejected', JSON.stringify({ name: fixture.name, report }));
    assert.equal(report.profile, 'SharpForge.TypedCIL.Numeric/1');
    assert.equal(report.methodToken, token);
  }
});

test('type confusion is rejected independently of the existing height-only admission', () => {
  const fixture = numericCases.find(value => value.name === 'Add_0_3');
  const inspector = new AssemblyInspector(numericFixture(fixture));
  assert.equal(verifyCilAssembly(inspector, { methodToken: token }).success, true);
  const report = verifyCilMethodTypes(inspector, token);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'StackUnexpected');
  assert.equal(inspector.getMethod(token).instructions[2].offset, report.diagnostics[0].offset);
});

test('slot, underflow, maxstack and return diagnostics are explicit', () => {
  const cases = [
    ['UnrecognizedArgumentNumber', { body: writer => writer.op('ldarg.0').op('ret') }],
    ['UnrecognizedLocalNumber', { body: writer => writer.op('ldloc', 65535).op('ret') }],
    ['StackUnderflow', { body: writer => writer.op('pop').op('ret') }],
    ['StackOverflow', { maxStack: 0, body: writer => writer.op('ldc.i4.1').op('pop').op('ret') }],
    ['ReturnVoid', { body: writer => writer.op('ldc.i4.1').op('ret') }],
    ['ReturnMissing', { result: 'int', body: writer => writer.op('ret') }],
    ['ReturnEmpty', { result: 'int', body: writer => writer.op('ldc.i4.1').op('dup').op('ret') }],
  ];
  for (const [diagnostic, fixture] of cases) {
    const report = verify({ name: diagnostic, ...fixture });
    assert.equal(report.status, 'rejected', diagnostic);
    assert.equal(report.diagnostics[0].diagnostic, diagnostic);
  }
});

test('unsupported metadata, bodies and opcodes cannot produce a typed proof', () => {
  const cases = [
    { parameters: ['int[]'], body: writer => writer.op('ret') },
    { static: false, body: writer => writer.op('ret') },
    { result: 'int&', parameters: ['int&'], body: writer => writer.op('ldarg.0').op('ret') },
    { noBody: true, body: writer => writer.op('ret') },
    { body: (writer, context) => writer.op('ldstr', 0x70000000 + context.md.userString('unsupported')).op('pop').op('ret') },
  ];
  for (const fixture of cases) assert.equal(verify({ name: 'Unsupported', ...fixture }).status, 'unknown');
  const malformed = verifyCilMethodTypes(new Uint8Array(10), token);
  assert.equal(malformed.status, 'rejected');
});

test('a local signature token cannot name a method StandAloneSig', () => {
  const bytes = managedFixture({ entry: null, methods: [{ name: 'MalformedLocalSignature', locals: ['int'],
    body: writer => writer.op('ret') }], decorate({ md }) {
    md.rows[17][0][0] = md.blob(Uint8Array.of(0, 0, 1));
  } });
  const report = verifyCilMethodTypes(bytes, token);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'InvalidLocalSignature');
});

test('bounded typed propagation checks cancellation, state-copy work and all dataflow limits', () => {
  const fixture = { name: 'Empty', maxStack: 0, body: writer => writer.op('ret') };
  assert.equal(verify(fixture, { maxTypedStackSlots: 0, maxDataflowSteps: 2, maxDataflowEdges: 0 }).status, 'verified');
  for (const options of [{ signal: AbortSignal.abort() }, { maxDataflowInstructions: 0 },
    { maxDataflowSteps: 0 }, { maxDataflowEdges: -1 }, { maxTypedStackSlots: -1 }]) {
    const report = verify(fixture, options);
    assert.equal(report.status, 'unknown');
    assert.ok(report.diagnostics[0].code.startsWith('CILDF'));
  }
  const diamond = numericCases.find(value => value.name === 'Diamond');
  assert.equal(verify(diamond, { maxTypedStackSlots: 8 }).status, 'unknown');
  assert.equal(verify(fixture, { maxNodes: 0 }).status, 'unknown');
  for (const value of [NaN, Infinity, '1', 1.5, 1000001])
    assert.equal(verify(fixture, { maxTypedStackSlots: value }).status, 'unknown');
});

test('bytecode after a reachable terminator remains unsupported when its policy is missing', () => {
  const bytes = managedFixture({ entry: null, methods: [{ name: 'Unreachable', body(writer, context) {
    writer.op('ret').op('ldstr', 0x70000000 + context.md.userString('hidden')).op('pop').op('ret');
  } }] });
  assert.equal(verifyCilMethodTypes(bytes, token).status, 'unknown');
});

test('unreachable branches still require an instruction-boundary target', () => {
  const report = verify({ name: 'InvalidUnreachableBranch', body: writer => writer.op('ret').op('br', 100) });
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'BadJumpTarget');
});

test('primitive storage addresses retain declared element identity and reject double addresses', () => {
  assert.equal(verify({ name: 'Pointer', parameters: ['int&'], body: writer => writer.op('ldarg.0').op('pop').op('ret') }).status,
    'verified');
  const report = verify({ name: 'DoublePointer', parameters: ['int&'], body: writer => writer.op('ldarga.s', 0).op('pop').op('ret') });
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'ByrefOfByref');
  const different = verify({ name: 'DifferentElements', parameters: ['int&', 'byte&'],
    body: writer => writer.op('ldarg.0').op('ldarg.1').op('ceq').op('pop').op('ret') });
  assert.equal(different.status, 'unknown');
  assert.equal(different.diagnostics[0].diagnostic, 'PointerComparisonUnavailable');
});

test('all native observations retain exact bytes and explicit predeclared ILVerify differences', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/verifier-numeric/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/verifier-numeric/input.js', import.meta.url))));
  assert.equal(capture.observations.length, numericCases.length);
  for (const fixture of numericCases) {
    const native = capture.observations.find(value => value.name === fixture.name);
    assert.equal(native.assemblySHA256, hash(numericFixture(fixture)), fixture.name);
    assert.equal(native.oracle.accepted, fixture.nativeAccepted ?? fixture.accepted, fixture.name);
    assert.equal(native.normativeAccepted, fixture.accepted);
    assert.equal(native.difference, fixture.difference ?? null);
    if (native.oracle.accepted !== fixture.accepted) assert.ok(fixture.difference, fixture.name);
  }
});
