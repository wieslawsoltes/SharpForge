import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';

// Caller info through #line directives and for parameter types other than int and string (SF-A02-T57). The
// Roslyn-pinned programs are the `caller-info` fixtures of packages/compiler/test/differential.

const usings = 'using System;\nusing System.Runtime.CompilerServices;\n';
const run = source => {
  const result = compile(source);
  assert.equal(result.success, true, result.diagnostics.map(d => d.code + ' ' + d.message).join('; '));
  return new VirtualMachine(result.image, { maxInstructions: 1_000_000 }).run().output;
};
const errorsOf = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => d.code);

test('#line remaps the line and the path; hidden keeps counting in the mapping before it; default returns', () => {
  const source =
    usings +
    'class P {\n' +
    '  static void L([CallerLineNumber] int line = 0, [CallerFilePath] string path = "") { Console.WriteLine(line + " " + path); }\n' +
    '  static void Main() {\n' +
    '    L();\n' +
    '#line 200 "mapped.cs"\n' +
    '    L();\n' +
    '#line hidden\n' +
    '    L();\n' +
    '#line default\n' +
    '    L();\n' +
    '  }\n' +
    '}\n';
  assert.equal(run(source), '6 Program.cs\n200 mapped.cs\n202 mapped.cs\n12 Program.cs\n');
});

test('the caller line converts to double and boxes to object; the member name boxes to object', () => {
  const source =
    usings +
    'class P {\n' +
    '  static void D([CallerLineNumber] double line = 0) { Console.WriteLine(line + 0.5); }\n' +
    '  static void O([CallerLineNumber] object line = null, [CallerMemberName] object name = null) { Console.WriteLine(line + " " + name); }\n' +
    '  static void Main() {\n' +
    '    D();\n' +
    '    O();\n' +
    '  }\n' +
    '}\n';
  assert.equal(run(source), '7.5\n8 Main\n');
});

test('which types take the caller line: every type an int constant converts to, also uint and ulong; not short or byte', () => {
  const declare = type => `${usings}class P { static void M([CallerLineNumber] ${type} line = 0) { } static void Main() { } }`;
  for (const type of ['long', 'double', 'float', 'decimal', 'uint', 'ulong', 'int?', 'long?', 'object']) {
    const source = type === 'object' ? declare(type).replace('= 0', '= null') : declare(type);
    assert.deepEqual(errorsOf(source).filter(code => code.startsWith('CS')), [], type);
  }
  for (const type of ['short', 'byte', 'sbyte', 'ushort']) {
    const codes = errorsOf(declare(type)).filter(code => code.startsWith('CS'));
    assert.deepEqual(codes, ['CS4017'], type);
  }
});
