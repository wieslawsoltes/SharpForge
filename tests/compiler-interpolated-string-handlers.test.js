import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { isInterpolatedStringHandlerType } from '../packages/compiler/src/conversions/interpolated-string-handler.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const header = 'using System;\nusing System.Runtime.CompilerServices;\n';
const handler = `
[InterpolatedStringHandler]
class H {
  public string Text = "";
  public H(int literalLength, int formattedCount) { Text = literalLength + "/" + formattedCount + ":"; }
  public void AppendLiteral(string s) { Text = Text + s; }
  public void AppendFormatted(int value) { Text = Text + "#" + value; }
  public void AppendFormatted(string value, int alignment = 0, string format = null) { Text = Text + value + alignment + format; }
}`;
const program = (body, declarations = handler) => `${header}${declarations}\nclass Program {\n  static void Main() {\n${body}\n  }\n}\n`;
const analysisOf = (source, options = {}) => analyze([parse(new SourceText(source, 'Program.cs'))], options);
const errorsOf = analysis => analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code);

/** The handler conversions of a program, with the analysis. */
function conversionsOf(source, options) {
  const analysis = analysisOf(source, options),
    found = [];
  const isHandler = node => node.kind === 'Conversion' && node.conversion?.kind === 'InterpolatedStringHandler';
  for (const body of analysis.bound.values()) walk(body, node => void (isHandler(node) && found.push(node)));
  return { analysis, found };
}

test('SF-A02-T75 corpus: the handler fixtures match Roslyn and .NET; a struct handler is recorded as not executable', () => {
  const pinned = loadPinned(),
    fixtures = loadFixtures().filter(f => f.feature === 'interpolated-string-handlers');
  assert.ok(fixtures.length >= 5);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    if (fixture.id === 'interpolated-string-handlers/struct-handler') {
      assert.equal(row.passed, false);
      assert.match(JSON.stringify(row.details), /SF2200/);
    } else assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T75 the conversion carries the bound pattern: constructor, counts and one call per part', () => {
  const { analysis, found } = conversionsOf(program('int n = 4; H h = $"ab {n} c {"s",3:F} {{}}";'));
  assert.deepEqual(errorsOf(analysis), []);
  assert.equal(analysis.incomplete, false);
  const [conversion] = found,
    pattern = conversion.conversion.handler;
  assert.equal(conversion.type.name, 'H');
  assert.equal(conversion.operand.kind, 'InterpolatedString');
  assert.equal(isInterpolatedStringHandlerType(conversion.type), true);
  assert.equal(isInterpolatedStringHandlerType(analysis.core.string), false);
  assert.equal(pattern.creation.constructor.toDisplayString(), 'H.H(int, int)');
  // "ab " + " c " + " {}" are 9 characters of literal text (an escaped brace counts once); two holes.
  assert.deepEqual(pattern.creation.args.map(argument => argument.expression.constantValue.value), [9, 2]);
  assert.equal(pattern.enabled, null);
  assert.equal(pattern.appendsReturnBool, false);
  assert.deepEqual(
    pattern.appends.map(call => call.method.toDisplayString()),
    ['H.AppendLiteral(string)', 'H.AppendFormatted(int)', 'H.AppendLiteral(string)', 'H.AppendFormatted(string, int, string)', 'H.AppendLiteral(string)'],
  );
  for (const call of pattern.appends) assert.equal(call.receiver, pattern.placeholder);
  // The hole's value is the bound hole of the string itself: it is bound once.
  assert.equal(pattern.appends[1].args[0].expression, conversion.operand.parts[0]);
  const formatted = pattern.appends[3].args.map(argument => argument.expression.constantValue?.value);
  assert.deepEqual(formatted, ['s', 3, 'F']);
});

test('SF-A02-T75 overload resolution: a handler parameter is better than string unless the string is a constant', () => {
  const picked = argument => {
    const source = program(`int n = 1; Use(${argument});`).replace('class Program {', 'class Program {\n  static int Use(string s) { return 0; }\n  static bool Use(H h) { return true; }');
    const analysis = analysisOf(source);
    assert.deepEqual(errorsOf(analysis), [], argument);
    let call = null;
    for (const body of analysis.bound.values()) walk(body, node => void (node.kind === 'Call' && node.method.name === 'Use' && (call = node)));
    return call.method.toDisplayString();
  };
  assert.equal(picked('$"a {n}"'), 'Program.Use(H)');
  assert.equal(picked('$"no holes"'), 'Program.Use(string)');
  assert.equal(picked('"literal"'), 'Program.Use(string)');
  assert.equal(picked('$"a" + "b"'), 'Program.Use(string)');
});

test('SF-A02-T75 diagnostics: missing members, a malformed return, an argument that does not fit, the language version', () => {
  const declare = members => `[InterpolatedStringHandler]\nclass H { ${members} }`,
    constructor = 'public H(int literalLength, int formattedCount) { }',
    codes = (members, text = '$"a {1}"') => errorsOf(analysisOf(program(`H h = ${text};`, declare(members))));
  assert.deepEqual(codes(constructor), ['CS1061', 'CS8941', 'CS1061', 'CS8941']);
  assert.deepEqual(codes('public void AppendLiteral(string s) { } public void AppendFormatted(int v) { }'), ['CS1729']);
  assert.deepEqual(codes(`${constructor} public void AppendLiteral(string s) { } public string AppendFormatted(int v) { return ""; }`), ['CS8941']);
  assert.deepEqual(codes(`${constructor} public bool AppendLiteral(string s) { return true; } public void AppendFormatted(int v) { }`), ['CS8942']);
  const complete = `${constructor} public void AppendLiteral(string s) { } public void AppendFormatted(int v) { }`;
  assert.deepEqual(codes(complete), []);
  assert.deepEqual(codes(complete, '$"a {"text"}"'), ['CS1503']);
  assert.deepEqual(codes(complete, '$"a {1,4}"'), ['CS1739']);
  assert.deepEqual(codes(complete, '$"a {1:X}"'), ['CS1739']);
  assert.deepEqual(codes(complete, '"plain"'), ['CS0029']);
  assert.deepEqual(errorsOf(analysisOf(program('H h = $"a {1}";'), { langVersion: '9' })), ['CS8773']);
  assert.deepEqual(errorsOf(analysisOf(program('H h = $"a {1}";'), { langVersion: '10' })), []);
  // Without the attribute the type is no handler: the string does not convert.
  assert.deepEqual(errorsOf(analysisOf(program('H h = $"a {1}";', handler.replace('[InterpolatedStringHandler]', '')))), ['CS0029']);
});

test('SF-A02-T75 execution: appends run in order, holes are evaluated inside their calls, on both back ends', () => {
  const lines = linesOf(
    program(
      `H h = $"x{Next()}y{"s",2:G}{Next()}";
    Console.WriteLine(h.Text);
    Console.WriteLine(Show($"{Next()}"));`,
    ).replace(
      'class Program {',
      'class Program {\n  static int calls;\n  static int Next() { calls = calls + 1; return calls; }\n  static string Show(H h) { return h.Text; }',
    ),
  );
  assert.deepEqual(lines, ['2/3:x#1ys2G#2', '0/1:#3']);
});

test('SF-A02-T75 execution: a disabled handler and an append that returns false stop the evaluation of later holes', () => {
  const declarations = `
[InterpolatedStringHandler]
class Gate {
  public string Text = "";
  public Gate(int literalLength, int formattedCount, out bool enabled) { enabled = formattedCount < 4; }
  public bool AppendLiteral(string s) { Text = Text + s; return true; }
  public bool AppendFormatted(int value) { Text = Text + value; return value != 0; }
}`;
  const lines = linesOf(
    program(
      `Gate open = $"a{Next()}b{0}c{Next()}";
    Console.WriteLine(open.Text + " " + calls);
    Gate closed = $"{Next()}{Next()}{Next()}{Next()}";
    Console.WriteLine("[" + closed.Text + "] " + calls);`,
      declarations,
    ).replace('class Program {', 'class Program {\n  static int calls;\n  static int Next() { calls = calls + 1; return calls; }'),
  );
  assert.deepEqual(lines, ['a1b0 1', '[] 1']);
});

test('SF-A02-T75 handler arguments are bound (tests/compiler-handler-arguments.test.js); a struct handler is SF2200', () => {
  const structHandler = `
[InterpolatedStringHandler]
struct S {
  public int N;
  public S(int literalLength, int formattedCount) { N = 0; }
  public void AppendLiteral(string s) { N = N + 1; }
  public void AppendFormatted(int value) { N = N + value; }
}`;
  const reported = notExecutable(program('S s = $"a {1}"; Console.WriteLine(s.N);', structHandler));
  assert.match(reported.message, /struct/);
});
