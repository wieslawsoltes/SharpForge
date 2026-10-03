import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, runOnBothBackEnds, notExecutable } from './support/semantic-codegen.js';
import { testPinnedFeature } from './support/pinned-feature.js';

// SF-A02-T06.7: a method group passed directly as an argument is converted to the delegate type of its parameter.
// The pinned fixtures print on both back ends what the same programs print on .NET (Roslyn 5.3.0, .NET 10).
testPinnedFeature('SF-A02-T06.7', 'method-group-arguments', { outputs: 2, diagnostics: 1 });

const program = (members, body) => `using System;\nusing System.Collections.Generic;\nclass Program { ${members} static void Main() { ${body} } }\n`;
const twice = 'static int Twice(int x) { return x * 2; } static int Negate(int x) { return -x; }';

/** Characters the runtime's type-name parser gives a meaning to; a synthesized name must not contain them. */
const parsedCharacters = /[<>,()[\]?*&`\s]/;

test('A02-T06.7 a method group argument is bound as a conversion to the parameter type', () => {
  const source = program(`${twice} static int Apply(Func<int, int> f, int v) { return f(v); }`, 'Console.WriteLine(Apply(Twice, 4));');
  const result = compile(source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code),
    [],
  );
  assert.deepEqual(linesOf(source), ['8']);
});

test('A02-T06.7 delegate classes are named without type-name characters, so arrays of delegates run', () => {
  const source = program(
    `${twice} static int Sum(params Func<int, int>[] fs) { int s = 0; foreach (var f in fs) s += f(1); return s; }`,
    `var table = new Func<int, int>[2]; table[0] = Twice; table[1] = Negate;
     Console.WriteLine(table[0](3) + table[1](3));
     Console.WriteLine(Sum(Twice, Negate, Twice));
     Func<int, string, bool> wide = (n, s) => s.Length == n; Console.WriteLine(wide(1, "a"));`,
  );
  const { image, output } = runOnBothBackEnds(source);
  assert.equal(output, '3\n3\nTrue\n');
  const names = image.types.map(type => type.name);
  assert.ok(names.includes('System.Func{int;int}'), names.join(' '));
  assert.ok(names.includes('System.Func{int;string;bool}'), names.join(' '));
  for (const name of names.filter(n => n.startsWith('System.Func'))) assert.doesNotMatch(name, parsedCharacters, name);
});

test('A02-T06.7 a method group over a framework method is refused, not miscompiled', () => {
  const source = program('static void Each(Action<int> add) { add(3); }', 'var list = new List<int>(); Each(list.Add); Console.WriteLine(list.Count);');
  assert.match(notExecutable(source).message, /delegates over framework methods/);
});
