import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, compileToAssembly, compileToIL, compileToReferenceAssembly } from '@sharpforge/compiler';
import { readPE } from '@sharpforge/cil';
import { literalInstructions, utf8DataRows } from './fixtures/utf8-rva/metadata.mjs';

const fixture = readFileSync(new URL('./fixtures/utf8-rva/Utf8Literals.cs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const errors = result => result.diagnostics.filter(item => item.severity === 'error');
const options = { name: 'Utf8Literals', outputKind: 'library', langVersion: '11' };
const emit = source => {
  const result = compileToAssembly(source, options);
  assert.deepEqual(errors(result), []);
  assert.ok(result.assembly);
  return result.assembly;
};

test('A02-T77 UTF-8 literals use static field addresses and the pointer span constructor without arrays', () => {
  const bytes = emit('using System; public class Utf8Literals { public static ReadOnlySpan<byte> Ascii() => "abc"u8; }');
  const body = literalInstructions(bytes, 'Ascii');
  assert.deepEqual(body.map(instruction => instruction.name), ['ldsflda', 'ldc.i4.3', 'newobj', 'ret']);
  const data = utf8DataRows(bytes);
  assert.equal(data.length, 1);
  assert.equal(data[0].token, body[0].operand);
  assert.deepEqual(data[0].bytes, [97, 98, 99, 0]);
  assert.equal(data[0].flags & 0x130, 0x130);
});

test('A02-T77 exact UTF-8 payloads, empty data and deduplication survive real PE layout', () => {
  const bytes = emit(fixture);
  const rows = utf8DataRows(bytes);
  const byToken = new Map(rows.map(row => [row.token, row]));
  const dataOf = method => byToken.get(literalInstructions(bytes, method).find(item => item.name === 'ldsflda').operand);
  const text = (method, value) => assert.deepEqual(dataOf(method).bytes, [...new TextEncoder().encode(value), 0]);
  text('Empty', '');
  text('Ascii', 'SharpForge');
  text('Unicode', 'héλ😀');
  text('Embedded', '\0A\0ÿ\0');
  text('Raw', 'first "quoted"\nsecond 😀');
  for (const [method, value] of [['One', 'a'], ['Three', 'abc'], ['Seven', 'abcdefg'], ['Eight', 'abcdefgh']]) text(method, value);
  assert.equal(dataOf('Ascii'), dataOf('Duplicate'));
  assert.equal(dataOf('Unicode'), dataOf('Concatenated'));
  for (const row of rows) {
    assert.match(row.name, /^[A-F0-9]{64}$/);
    assert.equal(row.bytes.at(-1), 0);
    if (row.packing !== null) assert.equal(row.packing, 1);
  }
  assert.deepEqual(emit(fixture), bytes, 'literal fields and content identity are deterministic');
});

test('A02-T77 nested functions, initializer calls, generic methods and late state machines share planned data', () => {
  const bytes = emit(fixture);
  const payloads = utf8DataRows(bytes).map(row => Buffer.from(row.bytes).toString('hex'));
  for (const value of ['local', 'field', 'base', 'generic', 'stack', 'iter', '😀']) {
    assert.ok(payloads.includes(Buffer.from(value + '\0').toString('hex')), value);
  }
  const lambda = emit(`using System; public class Utf8Literals {
    public delegate ReadOnlySpan<byte> Factory(); public static Factory Make() => () => "lambda"u8;
  }`);
  assert.deepEqual(utf8DataRows(lambda).map(row => row.bytes), [[108, 97, 109, 98, 100, 97, 0]]);
});

test('A02-T77 executable assemblies retain literal data; reference assemblies omit body-only storage', () => {
  const source = 'using System; public class Program { public static void Main() { Console.WriteLine("a"u8.Length); } }';
  const executable = compileToAssembly(source, { langVersion: '11' });
  assert.deepEqual(errors(executable), []);
  assert.equal(utf8DataRows(executable.assembly).length, 1);
  assert.ok(readPE(executable.assembly).entryPoint);
  const reference = compileToReferenceAssembly(fixture, options);
  assert.deepEqual(errors(reference), []);
  assert.deepEqual(utf8DataRows(reference.assembly), []);
  const metadata = readPE(reference.assembly).metadata;
  assert.ok(!metadata.rows[2].some(row => metadata.string(row[1]) === '<PrivateImplementationDetails>'));
  assert.deepEqual(utf8DataRows(emit('public class Plain { public static int Value() => 1; }')), []);
});

test('A02-T77 malformed UTF-16, language gates and non-literal operators remain C# diagnostics', () => {
  const prefix = 'using System; public class C { public static void Main() { ';
  const suffix = ' } }';
  const codes = (body, langVersion = '11') => errors(compileToAssembly(prefix + body + suffix, { langVersion })).map(item => item.code);
  assert.ok(codes('ReadOnlySpan<byte> value = "\\uD800"u8;').includes('CS9026'));
  assert.ok(codes('ReadOnlySpan<byte> value = "a"u8;', '10').some(code => code === 'CS8936'));
  assert.ok(codes('var value = "a"u8 + "b";').includes('CS0019'));
  assert.ok(codes('string value = "a"u8;').includes('CS0029'));
});

test('A02-T77 the bytecode execution profile reports its unsupported span contract explicitly', () => {
  for (const api of [compile, compileToIL]) {
    const result = api('class C { static void Main() { var value = "a"u8; } }', { langVersion: '11' });
    assert.equal(result.image ?? null, null);
    assert.ok(errors(result).some(item => item.code === 'SF2200'));
  }
});
