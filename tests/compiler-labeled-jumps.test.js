import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

// SF-A02-T93: labeled break and continue. PROVISIONAL C# 15 preview feature: the pinned Roslyn does not implement
// it, so there is no Roslyn fixture. The expected results below are what the pinned proposal revision specifies
// (csharplang proposals/csharp-15.0/labeled-break-continue.md, revision 1); each test names the rule it checks.

const preview = { langVersion: 'preview' };
// `Func<int>` keeps the programs outside the string-typed profile, so they go through the semantic pipeline.
const program = body =>
  `using System; using System.Collections.Generic; class Program { static IEnumerable<int> Pairs() { ${iterator} } ` +
  `static void Main() { Func<int> zero = () => 0; ${body} } }`;
const iterator = 'outer: for (int i = 0; i < 3; i++) { for (int j = 0; j < 3; j++) { if (j == 1) continue outer; if (i == 2) break outer; yield return i * 10 + j; } }';
function run(body) {
  const source = program(body),
    result = compile(source, preview);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message), []);
  const il = compileToIL(source, { ...preview, includeDebug: false });
  const bytecode = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, bytecode);
  return bytecode;
}
const errors = (body, options = preview) => {
  const source = program(body);
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};

test('A02-T93 break L exits the enclosing statement labeled L; continue L starts its next iteration', () => {
  const body =
    'outer: for (int i = zero(); i < 4; i++) { foreach (var j in new List<int> { 1, 2, 3 }) { if (j == 2) continue outer; if (i == 2) break outer; ' +
    'Console.Write(i + ":" + j + " "); } Console.Write("never "); } Console.WriteLine("done");';
  assert.equal(run(body), '0:1 1:1 done\n');
});

test('A02-T93 continue L runs the for-iterator and the condition of the labeled loop', () => {
  const body = 'int steps = 0; a: for (int i = zero(); i < 3; i++, steps++) { while (true) { continue a; } } Console.WriteLine(steps);';
  assert.equal(run(body), '3\n');
  assert.equal(run('int n = zero(); b: do { n++; while (true) { if (n < 3) continue b; break b; } } while (n < 10); Console.WriteLine(n);'), '3\n');
});

test('A02-T93 a labeled switch is a break target; break L in a switch inside a labeled loop leaves the loop', () => {
  const body =
    'int k = zero(); loop: while (true) { k++; switch (k) { case 3: break loop; default: continue loop; } } ' +
    'pick: switch (k) { case 3: while (true) { break pick; } default: Console.Write("no "); break; } Console.WriteLine(k);';
  assert.equal(run(body), '3\n');
});

test('A02-T93 the finally blocks a labeled jump leaves are run', () => {
  const body =
    'o: for (int i = zero(); i < 2; i++) { for (;;) { try { if (i == 0) continue o; break o; } finally { Console.Write("f" + i + " "); } } } Console.WriteLine("end");';
  assert.equal(run(body), 'f0 f1 end\n');
});

test('A02-T93 labeled jumps inside an iterator', () => {
  assert.equal(run('foreach (var p in Pairs()) Console.Write(p + " "); Console.WriteLine();'), '0 10 \n');
});

test('A02-T93 only the immediately nested statement is labeled: in a: b: while, a labels nothing', () => {
  assert.deepEqual(errors('a: b: while (true) { break a; }'), ['CS0139:break a;']);
  assert.deepEqual(errors('a: b: while (true) { break b; }'), []);
});

test('A02-T93 no enclosing statement with that label is a compile-time error (CS0139)', () => {
  assert.deepEqual(errors('a: for (;;) { break b; }'), ['CS0139:break b;']);
  assert.deepEqual(errors('for (;;) { continue missing; }'), ['CS0139:continue missing;']);
  // A labeled block is not a switch or iteration statement.
  assert.deepEqual(errors('c: { break c; }'), ['CS0139:break c;']);
  // A label of a sibling statement does not enclose the jump.
  assert.deepEqual(errors('a: for (;;) { break; } for (;;) { break a; }'), ['CS0139:break a;']);
});

test('A02-T93 continue cannot target a switch: it finds no iteration statement with that label', () => {
  assert.deepEqual(errors('s: switch (zero()) { default: for (;;) { continue s; } }'), ['CS0139:continue s;']);
});

test('A02-T93 a lambda body is not enclosed by the statements of its method', () => {
  assert.deepEqual(errors('d: for (;;) { Action f = () => { break d; }; break; }'), ['CS0139:break d;']);
});

test('A02-T93 a labeled jump cannot leave a finally block (CS0157)', () => {
  assert.deepEqual(errors('a: for (;;) { try { } finally { break a; } }'), ['CS0157:break']);
  assert.deepEqual(errors('a: for (;;) { try { } finally { b: for (;;) { break b; } } break; }'), []);
});

test('A02-T93 is a preview feature: CS8652 unless LangVersion is preview', () => {
  assert.deepEqual(errors('a: for (;;) { break a; }', { langVersion: '14' }).at(-1), 'CS8652:a');
  assert(errors('', { langVersion: '14' }).every(row => row.startsWith('CS8652:')));
  assert.deepEqual(errors('a: for (;;) { break a; }'), []);
});

test('A02-T93 the same rules reach programs the string-typed pipeline compiles on its own', () => {
  const simple = body => `class Program { static void Main() { ${body} } }`;
  const codes = body => compile(simple(body), preview).diagnostics.filter(d => d.severity === 'error').map(d => d.code);
  assert.deepEqual(codes('a: b: while (true) { break a; }'), ['CS0139']);
  assert.deepEqual(codes('a: for (;;) { break a; }'), []);
});
