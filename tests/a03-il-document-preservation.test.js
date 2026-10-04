import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { assembleILDocument, formatILDocument, readPE, writeMethodBody, loadAssembly, CilError } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { managedFixture } from './managed-fixtures.js';

const methodToken = 0x06000001;

function exactRoundtrip(bytes, expectedMethods) {
  const document = formatILDocument(bytes);
  const result = assembleILDocument(document);
  expectedMethods ??= (readPE(bytes).metadata.rows[6] ?? []).filter(row => row[0] !== 0).length;
  assert.deepEqual(result.bytes, bytes);
  assert.notEqual(result.bytes.buffer, bytes.buffer);
  assert.equal(result.methods, expectedMethods);
  assert.deepEqual(result.warnings, []);
  assert.equal(formatILDocument(result.bytes), document);
  return result;
}

function finallyFixture() {
  return managedFixture({ methods: [{
    name: 'Main', result: 'void',
    body: writer => writer.mark('try').op('nop').op('leave.s', 'done')
      .mark('finally').op('endfinally').mark('done').op('ret'),
    handlers: labels => [{ flags: 2, start: labels.get('try'), end: labels.get('finally'),
      target: labels.get('finally'), handlerEnd: labels.get('done'), catchType: 0 }],
  }] });
}

function publicSignedFixture() {
  const keys = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/public-keys.json', import.meta.url), 'utf8')).cases;
  const publicKey = new Uint8Array(Buffer.from(keys[1].key, 'hex'));
  const compiled = compileToIL('Console.WriteLine(42);', {
    publicKey, publicSign: true, includeDebug: true, portablePdb: false, embedSources: false,
  });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled.assembly;
}

test('IL no-change images retain fat bodies, padding, checksum and empty method inventories exactly', () => {
  const bytes = managedFixture();
  const pe = readPE(bytes);
  new DataView(bytes.buffer).setUint32(pe.optionalStart + 64, 0x12345678, true);
  exactRoundtrip(bytes);
  exactRoundtrip(managedFixture({ methods: [], entry: null }), 0);
});

test('IL no-change images retain tiny headers rather than replacing them with equivalent fat headers', () => {
  const bytes = managedFixture({ methods: [{ name: 'Main', result: 'int', initLocals: false,
    body: writer => writer.op('ldc.i4.s', 42).op('ret') }] });
  const body = readPE(bytes).methodBody(methodToken);
  const code = body.code.slice();
  bytes[body.fileOffset] = code.length * 4 + 2;
  bytes.set(code, body.fileOffset + 1);
  assert.equal(readPE(bytes).methodBody(methodToken).headerSize, 1);
  exactRoundtrip(bytes);
});

test('IL no-change images retain small exception sections and their untouched trailing bytes', () => {
  const bytes = finallyFixture();
  const body = readPE(bytes, { inspection: true }).methodBody(methodToken);
  const small = writeMethodBody(body.code, body.localSignature, body.maxStack, body.handlers, { exceptionFormat: 'small' });
  bytes.set(small, body.fileOffset);
  assert.deepEqual(readPE(bytes, { inspection: true }).methodBody(methodToken).handlers, body.handlers);
  exactRoundtrip(bytes);
});

test('IL no-change public-sign and debug-profile images preserve identity and both JavaScript execution routes', () => {
  const bytes = publicSignedFixture();
  const original = readPE(bytes);
  assert.equal(original.flags & 8, 8);
  assert.equal(original.metadata.streams.has('#SF'), true);
  const rebuilt = exactRoundtrip(bytes);
  for (const create of [() => new VirtualMachine(loadAssembly(rebuilt.bytes), { maxInstructions: 64 }),
    () => new CilVirtualMachine(rebuilt.bytes, { maxInstructions: 64 })]) {
    const vm = create();
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '42\n');
    } finally { vm.stop(); }
  }
});

test('IL actual edits clear signature reservations and stale debug data, then become byte-stable', () => {
  const bytes = publicSignedFixture();
  const original = readPE(bytes);
  const signatureOffset = original.offsetOf(original.strongNameSignature.rva, original.strongNameSignature.size);
  // The inspector retains opaque signature bytes; this does not authenticate the synthetic payload.
  bytes.fill(0xa5, signatureOffset, signatureOffset + original.strongNameSignature.size);
  exactRoundtrip(bytes);
  const rebuilt = assembleILDocument(formatILDocument(bytes).replace('ldc.i4 42', 'ldc.i4 43'));
  const pe = readPE(rebuilt.bytes);
  assert.equal(pe.flags & 8, 0);
  assert.deepEqual(pe.strongNameSignature, { rva: 0, size: 0 });
  assert.equal(pe.metadata.streams.has('#SF'), false);
  assert.ok(rebuilt.warnings.length > 0);
  assert.ok(rebuilt.bytes.subarray(signatureOffset, signatureOffset + original.strongNameSignature.size).every(byte => byte === 0));
  assert.throws(() => loadAssembly(rebuilt.bytes), /arbitrary .NET assembly/);
  exactRoundtrip(rebuilt.bytes);
});

test('IL partial edits retain unchanged method RVAs while replacing the edited body', () => {
  const bytes = managedFixture({ methods: [
    { name: 'Main', result: 'int', body: writer => writer.op('ldc.i4', 1).op('ret') },
    { name: 'Unchanged', result: 'int', body: writer => writer.op('ldc.i4', 2).op('ret') },
  ] });
  const original = readPE(bytes);
  const rebuilt = assembleILDocument(formatILDocument(bytes).replace('ldc.i4 1', 'ldc.i4 7'));
  const pe = readPE(rebuilt.bytes);
  assert.notEqual(pe.metadata.row(methodToken)[0], original.metadata.row(methodToken)[0]);
  assert.equal(pe.metadata.row(methodToken + 1)[0], original.metadata.row(methodToken + 1)[0]);
  assert.deepEqual(pe.methodBody(methodToken + 1).code, original.methodBody(methodToken + 1).code);
  assert.ok(rebuilt.bytes.length > bytes.length);
  exactRoundtrip(rebuilt.bytes, 2);
});

test('IL stack, locals, initialization and exception-clause changes cannot take the no-change path', () => {
  const bytes = managedFixture({ methods: [{ name: 'Main', locals: ['int'], body: writer => writer.op('ret') }] });
  const document = formatILDocument(bytes);
  for (const [before, after, field, expected] of [
    ['.maxstack 8', '.maxstack 0', 'maxStack', 0],
    ['.locals 0x11000001', '.locals 0x00000000', 'localSignature', 0],
    ['.initlocals 1', '.initlocals 0', 'initLocals', false],
  ]) {
    const rebuilt = assembleILDocument(document.replace(before, after)).bytes;
    assert.notDeepEqual(rebuilt, bytes);
    assert.equal(readPE(rebuilt).methodBody(methodToken)[field], expected);
    exactRoundtrip(rebuilt);
  }
  const handlers = finallyFixture();
  const edited = assembleILDocument(formatILDocument(handlers).replace('.eh 2 ', '.eh 4 ')).bytes;
  assert.notDeepEqual(edited, handlers);
  assert.equal(readPE(edited, { inspection: true }).methodBody(methodToken).handlers[0].flags, 4);
  exactRoundtrip(edited);
});

test('IL no-change candidate still validates all methods, locals, options, alignment and exception ranges', () => {
  const document = formatILDocument(managedFixture());
  for (const malformed of [
    document.slice(0, document.indexOf('.method')),
    document + document.slice(document.indexOf('.method')),
    document.replace('ldc.i4 42', 'unknown.op'),
    document.replace('.locals 0x00000000', '.locals 0x11000000'),
  ]) assert.throws(() => assembleILDocument(malformed), CilError);
  assert.throws(() => assembleILDocument(document, { relaxBranches: 1 }), CilError);
  assert.throws(() => assembleILDocument(document, { maxUserStringBytes: -1 }), CilError);
  const malformedEH = formatILDocument(finallyFixture()).replace('.eh 2 IL_0000 IL_0003 ', '.eh 2 IL_0000 IL_0000 ');
  assert.throws(() => assembleILDocument(malformedEH), /Invalid exception range/);
  const bytes = managedFixture();
  new DataView(bytes.buffer).setUint32(readPE(bytes).optionalStart + 36, 0, true);
  assert.throws(() => assembleILDocument(formatILDocument(bytes)), /Unsupported PE alignment/);
});
