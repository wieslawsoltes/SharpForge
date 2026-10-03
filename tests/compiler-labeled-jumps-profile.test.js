import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { directlyLabeledStatement } from '../packages/compiler/src/binder/labeled-jumps.js';

// SF-A02-T93: labeled break and continue in programs of the string-typed profile (no construct outside it), which
// binds labeled statements through `directlyLabeledStatement` of binder/labeled-jumps.js. PROVISIONAL C# 15 preview
// feature: no Roslyn fixture exists; the expectations follow the pinned proposal revision
// (csharplang proposals/csharp-15.0/labeled-break-continue.md, revision 1).

const preview = { langVersion: 'preview' };
const program = body => `using System; class Program { static void Main() { ${body} } }`;
const rows = (body, options = preview) => {
  const source = program(body);
  return compile(source, options).diagnostics.map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};
function run(body) {
  const source = program(body),
    result = compile(source, preview);
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error').map(d => d.code), [], body);
  const bytecode = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(compileToIL(source, { ...preview, includeDebug: false }).assembly).run().output, bytecode);
  return bytecode;
}

test('A02-T93 profile: jumps to a directly labeled loop or switch run on both back ends', () => {
  // j == 1 continues the outer loop, so each of the three outer iterations counts once.
  const counting = 'int n = 0; outer: for (int i = 0; i < 3; i++) { for (int j = 0; j < 3; j++) { if (j == 1) continue outer; n++; } } Console.WriteLine(n);';
  assert.equal(run(counting), '3\n');
  assert.equal(run('int k = 0; loop: while (true) { k++; switch (k) { case 3: break loop; default: continue loop; } } Console.WriteLine(k);'), '3\n');
});

test('A02-T93 profile: only the immediately nested statement is labeled (in a: b: while, a labels nothing)', () => {
  // The semantic binder's rule is taken for a program the profile compiles: exactly one error, on the jump.
  assert.deepEqual(rows('a: b: while (true) { break a; }').filter(row => !row.startsWith('CS0164')), ['CS0139:break a;']);
  assert.equal(run('a: b: while (true) { break b; } Console.WriteLine("ok");'), 'ok\n');
});

test('A02-T93 profile: a labeled block is not a target, and other labeled statements keep working', () => {
  assert(rows('c: { break c; }').includes('CS0139:break c;'));
  assert.equal(run('goto x; x: Console.WriteLine("labeled");'), 'labeled\n');
});

test('A02-T93 profile: the feature is gated below preview (CS8652)', () => {
  const found = rows('a: for (;;) { break a; }', { langVersion: '14' });
  assert(found.some(row => row.startsWith('CS8652:')), found.join(' | '));
});

test('A02-T93 the profile rule is one function: labels of a loop or switch, duplicate label (CS0140), anything else SF2142', () => {
  const reported = [],
    report = (node, code) => reported.push(code),
    loop = { kind: 'While' },
    labeled = (label, body) => ({ kind: 'Labeled', label, body });
  assert.deepEqual(directlyLabeledStatement(labeled('a', loop), [], report).labels, ['a']);
  assert.deepEqual(reported, []);
  assert.deepEqual(directlyLabeledStatement(labeled('a', labeled('b', loop)), [], report).labels, ['a', 'b']);
  assert.deepEqual(reported, []);
  directlyLabeledStatement(labeled('a', { kind: 'Block' }), [], report);
  assert.deepEqual(reported.splice(0), ['SF2142']);
  directlyLabeledStatement(labeled('a', loop), [{ labels: ['a'] }], report);
  assert.deepEqual(reported.splice(0), ['CS0140']);
});
