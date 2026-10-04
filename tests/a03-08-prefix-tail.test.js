import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CilWriter, validateTailPrefixes, tailPrefixDiagnosticCatalog } from '@sharpforge/cil';

const tail = { name: 'tail.' };
const caught = (start, end, target, handlerEnd) => ({ start, end, target, handlerEnd, catchType: 0x01000001 });
const errorAt = (code, offset) => error => error.code === code && error.offset === offset;
const call = () => new CilWriter().group('call', 0x06000001, [tail]);

test('tail call/callvirt/calli accept immediate ret and return owned groups', () => {
  assert.equal(Object.keys(tailPrefixDiagnosticCatalog).length, 3);
  for (const name of ['call', 'callvirt', 'calli']) {
    const bytes = new CilWriter().group(name, name === 'calli' ? 0x11000001 : 0x06000001, [tail]).op('ret').finish();
    const groups = validateTailPrefixes(bytes);
    assert.equal(groups[0].name, name);
    assert.equal(groups[0].prefixes[0].name, 'tail.');
    bytes.fill(0);
    assert.equal(groups[0].operand, name === 'calli' ? 0x11000001 : 0x06000001);
  }
  assert.deepEqual(validateTailPrefixes(new Uint8Array()), []);
});

test('six illegal lexical patterns retain exact prefix or decoder offsets', () => {
  assert.throws(() => validateTailPrefixes(new CilWriter().group('nop', undefined, [tail]).op('ret').finish()),
    errorAt('CILPT0002', 0));
  assert.throws(() => validateTailPrefixes(call().finish()), errorAt('CILPT0003', 0));
  assert.throws(() => validateTailPrefixes(call().op('nop').op('ret').finish()), errorAt('CILPT0003', 0));
  assert.throws(() => validateTailPrefixes(call().group('ret', undefined, [{ name: 'volatile.' }]).finish()),
    errorAt('CILPT0003', 0));
  const duplicate = new CilWriter().group('call', 0x06000001, [tail, tail]).op('ret').finish();
  assert.throws(() => validateTailPrefixes(duplicate), errorAt('CILPT0001', 2));
  const skippedPrefix = new CilWriter().op('br.s', 'call').op('tail.').mark('call').op('call', 0x06000001).op('ret').finish();
  assert.throws(() => validateTailPrefixes(skippedPrefix), /instruction-group boundary/);
});

test('branches may enter the first prefix or the following ret', () => {
  for (const target of ['prefix', 'return']) {
    const writer = new CilWriter().op('br.s', target).mark('prefix').group('call', 0x06000001, [tail]).mark('return').op('ret');
    assert.doesNotThrow(() => validateTailPrefixes(writer.finish()));
  }
});

test('tail is excluded from tries and every handler/filter kind using the shared placement rule', () => {
  const inTry = call().op('ret').op('nop').finish();
  assert.throws(() => validateTailPrefixes(inTry, [caught(0, 8, 8, 9)]), errorAt('CILCF0006', 0));
  const inHandler = new CilWriter().op('nop').group('call', 0x06000001, [tail]).op('ret').finish();
  for (const flags of [0, 2, 4]) {
    const clause = { flags, start: 0, end: 1, target: 1, handlerEnd: 9, ...(flags ? {} : { catchType: 0x01000001 }) };
    assert.throws(() => validateTailPrefixes(inHandler, [clause]), errorAt('CILCF0006', 1));
  }
  const inFilter = new CilWriter().op('nop').group('call', 0x06000001, [tail]).op('ret').op('nop').finish();
  const clause = { flags: 1, start: 0, end: 1, filterOffset: 1, target: 9, handlerEnd: 10 };
  assert.throws(() => validateTailPrefixes(inFilter, [clause]), errorAt('CILCF0006', 1));
  const filteredHandler = { flags: 1, start: 0, end: 1, filterOffset: 1, target: 2, handlerEnd: 10 };
  const bytes = new CilWriter().op('nop').op('nop').group('call', 0x06000001, [tail]).op('ret').finish();
  assert.throws(() => validateTailPrefixes(bytes, [filteredHandler]), errorAt('CILCF0006', 2));
});

test('cursor membership expires after multiple completed regions before a tail', () => {
  const code = new CilWriter().op('nop').op('nop').op('nop').op('nop')
    .group('call', 0x06000001, [tail]).op('ret').finish();
  assert.doesNotThrow(() => validateTailPrefixes(code, [caught(0, 1, 1, 2), caught(2, 3, 3, 4)]));
});

test('prefix combinations retain structural grouping without claiming the other prefix semantics', () => {
  for (const prefixes of [[tail, { name: 'constrained.', operand: 0x01000001 }],
    [{ name: 'constrained.', operand: 0x01000001 }, tail]]) {
    assert.equal(validateTailPrefixes(new CilWriter().group('callvirt', 0x06000001, prefixes).op('ret').finish())[0].prefixes.length, 2);
  }
});

test('cancellation, input limits and malformed regions are checked before tail validation', () => {
  const bytes = call().op('ret').finish();
  assert.throws(() => validateTailPrefixes(bytes, [], { signal: AbortSignal.abort() }), errorAt('CILR0003', undefined));
  assert.throws(() => validateTailPrefixes(bytes, [], { maxCodeBytes: 7 }), error => error.code === 'CILR0002');
  assert.throws(() => validateTailPrefixes(bytes, [], { maxInstructions: 2 }), /limit/i);
  assert.throws(() => validateTailPrefixes(bytes, [], { maxPrefixes: 0 }), /prefix chain limit/i);
  assert.throws(() => validateTailPrefixes(bytes, [caught(0, 3, 7, 8)]), error => error.code === 'CILR0017');
});

test('lexical validity does not prove argument stack or managed-pointer lifetime safety', () => {
  const extraValue = new CilWriter().op('ldc.i4.1').group('call', 0x06000001, [tail]).op('ret').finish();
  const localAddress = new CilWriter().op('ldloca.s', 0).group('call', 0x06000001, [tail]).op('ret').finish();
  assert.doesNotThrow(() => validateTailPrefixes(extraValue));
  assert.doesNotThrow(() => validateTailPrefixes(localAddress));
});

test('pinned ILVerify observations and real CoreCLR execution cover the lexical tail contract', () => {
  const directory = new URL('./fixtures/a03-prefix-tail/', import.meta.url);
  const fixture = JSON.parse(readFileSync(new URL('native.json', directory), 'utf8'));
  const source = readFileSync(new URL('input.js', directory));
  assert.equal(createHash('sha256').update(source).digest('hex'), fixture.sourceSHA256);
  assert.equal(fixture.version, '10.0.5');
  assert.equal(fixture.observations.length, 6);
  assert.equal(fixture.observations.filter(value => value.oracle.accepted).length, 1);
  assert.equal(fixture.execution.exitCode, 42);
  assert.equal(fixture.execution.signal, null);
  for (const observation of fixture.observations) {
    const code = new Uint8Array(Buffer.from(observation.code, 'base64'));
    if (observation.oracle.accepted) {
      assert.doesNotThrow(() => validateTailPrefixes(code, observation.handlers));
      assert.deepEqual(observation.oracle.errors, []);
    } else {
      assert(observation.oracle.errors.length > 0);
      assert.throws(() => validateTailPrefixes(code, observation.handlers), error => error.code === observation.diagnostic);
    }
  }
});
