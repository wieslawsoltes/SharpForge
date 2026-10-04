import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { notExecutable } from './support/semantic-codegen.js';

// SF-A02-T30: `[InterpolatedStringHandlerArgument]` (C# 10). The handler's constructor receives, after the two counts,
// the receiver ("") or the named arguments of the call the interpolated string is an argument of. Reference for the
// behaviour on real .NET, also with the handler types of the class library (`StringBuilder.Append`, `Span.TryWrite`,
// `string.Create`): the Roslyn-pinned program `reduced-text/handler-arguments` (tests/compiler-stress-corpus.test.js).

const declarations = `using System; using System.Runtime.CompilerServices;
[InterpolatedStringHandler]
class H {
  public H(int literalLength, int formattedCount, Log log, int level) { }
  public void AppendLiteral(string value) { }
  public void AppendFormatted<T>(T value) { }
}
class Log {
  public void Write(int level, [InterpolatedStringHandlerArgument("", "level")] H handler) { }
  public void Late([InterpolatedStringHandlerArgument("level")] H handler, int level) { }
  public static void Text(ref string text) { }
}`;
const program = body => `${declarations}\nclass P { static void Main() { var log = new Log(); int n = 3; ${body} } }`;
const analysisOf = source => analyze([parse(new SourceText(source, 'Program.cs'))], {});
const errorsOf = diagnostics => diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code);

function handlerConversions(analysis) {
  const found = [];
  const isHandler = node => node.kind === 'Conversion' && node.conversion?.kind === 'InterpolatedStringHandler';
  for (const body of analysis.bound.values()) walk(body, node => void (isHandler(node) && found.push(node)));
  return found;
}

test('A02-T30 handler arguments: the constructor takes the receiver and the named argument after the counts', () => {
  const analysis = analysisOf(program('log.Write(n, $"a {n}");'));
  assert.deepEqual(errorsOf(analysis.diagnostics), []);
  assert.notEqual(analysis.incomplete, true);
  const [conversion] = handlerConversions(analysis),
    pattern = conversion.conversion.handler;
  assert.deepEqual(
    pattern.creation.constructor.parameters.map(parameter => parameter.name),
    ['literalLength', 'formattedCount', 'log', 'level'],
  );
  assert.deepEqual(
    pattern.argumentPlaceholders.map(placeholder => [placeholder.kind, placeholder.argumentIndex, placeholder.type.name]),
    [
      ['InterpolatedStringHandlerArgumentPlaceholder', -1, 'Log'],
      ['InterpolatedStringHandlerArgumentPlaceholder', 0, 'Int32'],
    ],
  );
  assert.equal(pattern.appends.length, 2);
});

test('A02-T30 handler arguments: the receiver and the argument are evaluated once, before the handler is created', () => {
  const result = compileToAssembly(program('log.Write(n + 1, $"a {n}");'), { name: 'Sample' });
  assert.deepEqual(errorsOf(result.diagnostics), []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === 'P'),
    main = type.methods.find(candidate => candidate.name === 'Main'),
    names = inspector.getMethod(main.token).instructions.map(instruction => {
      if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
      const target = inspector.resolveToken(instruction.operand);
      return `${instruction.name} ${target.owner}::${target.name}`;
    }),
    creation = names.indexOf('newobj H::.ctor'),
    call = names.indexOf('callvirt Log::Write');
  assert.ok(creation > 0 && call > creation, names.join('; '));
  // `n + 1` is computed once: one `add` before the handler is created, none after.
  assert.equal(names.filter(name => name === 'add').length, 1, names.join('; '));
  assert.ok(names.indexOf('add') < creation, names.join('; '));
  // The constructor reads the saved receiver and argument: four values are pushed for its four parameters.
  const opcode = name => name.split('.').slice(0, name.startsWith('ldc') ? 2 : 1).join('.');
  assert.deepEqual(names.slice(creation - 4, creation).map(opcode), ['ldc.i4', 'ldc.i4', 'ldloc', 'ldloc']);
});

test('A02-T30 handler arguments: an argument written after the handler is not bound, and nothing is invented', () => {
  const analysis = analysisOf(program('log.Late($"a {n}", n);'));
  assert.deepEqual(errorsOf(analysis.diagnostics), []);
  assert.equal(analysis.incomplete, true, 'the analysis says it did not bind the program completely');
});

test('A02-T30 only a handler may omit `ref`: an interpolated string for a `ref string` parameter is CS1620', () => {
  const analysis = analysisOf(program('Log.Text($"a {n}");'));
  assert.deepEqual(errorsOf(analysis.diagnostics), ['CS1620']);
});

test('A02-T30 handler arguments are not executable on the image pipeline: SF2200, never a wrong program', () => {
  const reported = notExecutable(program('log.Write(n, $"a {n}");'));
  assert.match(reported.message, /takes arguments of its call/);
});
