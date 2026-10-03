/**
 * SF-A02-T74: global using directives across compilation units and the `implicitUsings` option. The Roslyn-pinned
 * single-file cases are in packages/compiler/test/differential/fixtures/global-usings.js; the differential harness
 * compiles one file at a time, so the cross-file rules are tested here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';

const file = (uri, text) => ({ uri, text });
const located = (result, severity) => result.diagnostics.filter(d => d.severity === severity).map(d => `${d.code} ${d.uri}:${d.start}`);
const outputOf = result => {
  assert.deepEqual(located(result, 'error'), []);
  return new VirtualMachine(result.image).run().output;
};

test('SF-A02-T74 a global using of one file applies to every file', () => {
  const usings = file('usings.cs', 'global using System;\nglobal using static System.Math;\nglobal using Con = System.Console;\n');
  const profile = compile([usings, file('main.cs', 'class P { static void Main() { Console.WriteLine(Max(1, 2)); } }\n')]);
  assert.equal(outputOf(profile), '2\n');
  // An interface puts the program outside the execution profile: the semantic analysis binds the same directives.
  const semantic = compile([usings, file('main.cs', 'interface I { }\nclass P { static void Main() { Con.WriteLine(Abs(-3)); } }\n')]);
  assert.equal(outputOf(semantic), '3\n');
});

test('SF-A02-T74 an alias declared by two global directives is CS1537 on the later one, in its own file', () => {
  const result = compile([
    file('a.cs', 'global using A = System.Console;\n'),
    file('b.cs', 'global using A = System.Math;\nclass P { static void Main() { } }\n'),
    file('c.cs', 'class Q { }\n'),
  ]);
  assert.deepEqual(located(result, 'error'), ['CS1537 b.cs:13']);
});

test('SF-A02-T74 repeating a global using of another file is not a warning; repeating one of the same file is', () => {
  const result = compile([
    file('a.cs', 'global using System;\n'),
    file('b.cs', 'global using System;\nusing System;\nclass P { static void Main() { Console.WriteLine(1); } }\n'),
  ]);
  assert.deepEqual(located(result, 'error'), []);
  assert.deepEqual(located(result, 'warning'), ['CS0105 b.cs:27']);
});

test('SF-A02-T74 a global using that does not bind is reported once, in the file that wrote it', () => {
  const result = compile([
    file('a.cs', 'global using Nope.Missing;\n'),
    file('b.cs', 'interface I { }\nclass P { static void Main() { } }\n'),
    file('c.cs', 'class Q { }\n'),
  ]);
  assert.deepEqual(
    located(result, 'error').filter(e => e.startsWith('CS0246')),
    ['CS0246 a.cs:13'],
  );
});

test('SF-A02-T74 placement is checked for programs the pipeline compiles (CS8914, CS8915)', () => {
  const codes = source =>
    compile(source)
      .diagnostics.filter(d => d.severity === 'error')
      .map(d => d.code);
  assert.deepEqual(codes('using System;\nglobal using System.Text;\nclass P { static void Main() { } }\n'), ['CS8915']);
  assert.deepEqual(codes('namespace N { global using System; }\nclass P { static void Main() { } }\n'), ['CS8914']);
  assert.deepEqual(codes('global using System;\nusing System.Text;\nclass P { static void Main() { } }\n'), []);
});

test('SF-A02-T74 implicitUsings adds the SDK namespaces, or the listed ones, as a generated compilation unit', () => {
  const source = 'interface I { }\nclass P { static void Main() { Console.WriteLine(new List<int>().Count); } }\n';
  assert.equal(outputOf(compile(source, { implicitUsings: true })), '0\n');
  const listed = compile('interface I { }\nclass P { static void Main() { Con.WriteLine(Max(1, 2)); } }\n', {
    implicitUsings: ['static System.Math', 'Con = System.Console'],
  });
  assert.equal(outputOf(listed), '2\n');
  assert.equal(compile(source, { implicitUsings: [] }).success, false);
});

test('SF-A02-T74 implicit usings are global using directives: they need C# 10', () => {
  const result = compile('class P { static void Main() { } }\n', { implicitUsings: ['System'], langVersion: '9' });
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.uri}`),
    ['CS8773 GlobalUsings.g.cs'],
  );
});
