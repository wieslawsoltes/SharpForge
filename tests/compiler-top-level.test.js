/**
 * SF-A02-T70: top-level statements. The Roslyn-pinned single-file cases are in
 * packages/compiler/test/differential/fixtures/top-level.js; these tests cover what needs several files or compiler
 * options, and the boundary between the execution pipeline and the semantic analysis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

const errorsOf = result => result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.uri}`);
const file = (uri, text) => ({ uri, text });

test('SF-A02-T70 only one compilation unit may have top-level statements (CS8802)', () => {
  const result = compile([file('a.cs', 'System.Console.WriteLine(1);\n'), file('b.cs', 'System.Console.WriteLine(2);\n')]);
  assert.equal(result.success, false);
  assert.ok(errorsOf(result).includes('CS8802 b.cs'), errorsOf(result).join('; '));
});

test('SF-A02-T70 a library cannot have top-level statements (CS8805)', () => {
  const result = compile('System.Console.WriteLine(1);\n', { outputKind: 'library' });
  assert.equal(result.success, false);
  assert.ok(errorsOf(result).some(e => e.startsWith('CS8805')), errorsOf(result).join('; '));
});

test('SF-A02-T70 a local of the statements is CS8801 in a type of the same file and unknown in another file', () => {
  const sameFile = compile('int x = 1;\nSystem.Console.WriteLine(x);\nclass C { int M() => x; }\n');
  assert.deepEqual(errorsOf(sameFile), ['CS8801 file:///input.cs'].map(e => e.replace('file:///input.cs', sameFile.diagnostics[0].uri)));
  const otherFile = compile([file('a.cs', 'int x = 1;\nSystem.Console.WriteLine(x);\n'), file('b.cs', 'class C { int M() => x; }\n')]);
  assert.deepEqual(errorsOf(otherFile), ['CS0103 b.cs']);
});

test('SF-A02-T70 the statements see the static members of partial class Program declared in another file', () => {
  const result = compile([
    file('main.cs', 'System.Console.WriteLine(Twice(21));\n'),
    file('program.cs', 'partial class Program { static int Twice(int v) => v * 2; }\n'),
  ]);
  assert.deepEqual(errorsOf(result), []);
  assert.ok(result.image);
});

test('SF-A02-T70 a program the pipeline compiles is still checked for Program, args and empty statements', () => {
  const codes = source =>
    compile(source)
      .diagnostics.filter(d => d.severity === 'error')
      .map(d => d.code);
  assert.deepEqual(codes('System.Console.WriteLine(1);\nclass Program { }\n'), ['CS0260']);
  assert.deepEqual(codes('int args = 1;\nSystem.Console.WriteLine(args);\n'), ['CS0136']);
  assert.deepEqual(codes(';\n'), ['CS8937']);
  assert.deepEqual(codes('System.Console.WriteLine(args.Length);\nclass D { }\n'), []);
});

test('SF-A02-T70 an unused top-level local function is a warning, a used one is not', () => {
  const warnings = source =>
    compile(source)
      .diagnostics.filter(d => d.severity === 'warning')
      .map(d => d.code);
  assert.deepEqual(warnings('void Unused() { }\nSystem.Console.WriteLine(1);\n'), ['CS8321']);
  assert.deepEqual(warnings('void Used() { }\nUsed();\n'), []);
});

test('SF-A02-T70 the exit value, args and await run on both back ends', () => {
  const source = `using System;
using System.Threading.Tasks;
int total = args.Length;
total += await Task.FromResult(0);
for (int i = 1; i <= 3; i++) total += Double(i);
Console.WriteLine(total);
return total;
static int Double(int v) => v * 2;
`;
  assert.deepEqual(linesOf(source), ['12']);
});

test('SF-A02-T70 limit: CS8803 is reported by the semantic analysis, not for a program the pipeline compiles alone', () => {
  const codes = source =>
    compile(source)
      .diagnostics.filter(d => d.severity === 'error')
      .map(d => d.code);
  assert.deepEqual(codes('struct D { }\nSystem.Console.WriteLine(1);\n').includes('CS8803'), true);
  assert.deepEqual(codes('class D { }\nSystem.Console.WriteLine(1);\n'), []);
});
