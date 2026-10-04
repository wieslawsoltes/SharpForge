import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// The awaitable pattern (SF-A02-T58). The Roslyn-pinned programs are the `awaitable-pattern` fixtures of
// packages/compiler/test/differential.

const usings = 'using System; using System.Runtime.CompilerServices; using System.Threading.Tasks;';
const awaiter = (isCompleted, extra = '') => `
  class Awaiter : INotifyCompletion {
    ${isCompleted}
    public void OnCompleted(Action continuation) { }
    public int GetResult() { return 7; }
    ${extra}
  }
  class Awaitable { public Awaiter GetAwaiter() { return new Awaiter(); } }`;
const program = (types, body) => `${usings} ${types} class P { static async Task<int> Run() { ${body} } static void Main() { Console.WriteLine(Run().Result); } }`;

function analysed(source) {
  const result = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  assert.equal(result.incomplete, false, 'the analysis is complete');
  return result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}

test('an awaitable type is awaited through GetAwaiter, IsCompleted and GetResult; the result type is that of GetResult', () => {
  const types = awaiter('public bool IsCompleted => true;');
  assert.deepEqual(analysed(program(types, 'int x = await new Awaitable(); return x;')), []);
  assert.deepEqual(analysed(program(types, 'string s = await new Awaitable(); return 1;')), ['CS0029:await new Awaitable()']);
});

test('GetAwaiter may be an extension method', () => {
  const types = `class Awaiter : INotifyCompletion { public bool IsCompleted => true; public void OnCompleted(Action c) { } public int GetResult() { return 1; } }
    static class E { public static Awaiter GetAwaiter(this string s) { return new Awaiter(); } }`;
  assert.deepEqual(analysed(program(types, 'return await "text";')), []);
  assert.deepEqual(analysed(program(types, 'return await 5;')), ['CS1061:await 5']);
});

test('each missing piece of the pattern has its own diagnostic, on the whole await expression', () => {
  const body = 'return await new Awaitable();';
  const cases = [
    [awaiter(''), 'CS0117'],
    [awaiter('public int IsCompleted => 1;'), 'CS4011'],
    [awaiter('public static bool IsCompleted => true;'), 'CS0176'],
    [awaiter('public bool IsCompleted => true;').replace(' : INotifyCompletion', ''), 'CS4027'],
    [awaiter('public bool IsCompleted => true;').replace('public int GetResult()', 'int GetResult()'), 'CS0122'],
    [awaiter('public bool IsCompleted => true;').replace('GetResult()', 'GetResult(int x)'), 'CS7036'],
    [awaiter('public bool IsCompleted => true;').replace('public Awaiter GetAwaiter()', 'public static Awaiter GetAwaiter()'), 'CS1986'],
  ];
  for (const [types, code] of cases) assert.deepEqual(analysed(program(types, body)), [`${code}:await new Awaitable()`], code);
  assert.deepEqual(analysed(program('', 'return await null;')), ['CS4001:await null']);
});

test('an awaiter whose IsCompleted is the constant true runs: GetAwaiter().GetResult()', () => {
  for (const isCompleted of ['public bool IsCompleted => true;', 'public bool IsCompleted { get { return true; } }', 'public bool IsCompleted { get => (true); }']) {
    const result = compile(program(awaiter(isCompleted), 'return await new Awaitable() + 1;'));
    assert.equal(result.success, true, isCompleted + ' ' + result.diagnostics.map(d => d.code + ' ' + d.message).join('; '));
    assert.equal(new VirtualMachine(result.image, { maxInstructions: 1_000_000 }).run().output, '8\n');
  }
});

test('an awaiter that may be pending is SF2200 naming the missing continuation', () => {
  const pending = [
    awaiter('bool done; public bool IsCompleted => done;'),
    awaiter('public bool IsCompleted { get { Console.WriteLine(1); return true; } }'),
  ];
  for (const types of pending) {
    const result = compile(program(types, 'return await new Awaitable();'));
    const errors = result.diagnostics.filter(d => d.severity === 'error' && !/^SF1|^SF20/.test(d.code));
    assert.equal(result.success, false);
    assert.deepEqual(errors.map(d => d.code), ['SF2200']);
    assert.match(errors[0].message, /await of 'Awaiter', whose IsCompleted is not the constant true \(the runtime has no continuation/);
  }
});
