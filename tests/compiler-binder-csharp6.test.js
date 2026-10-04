import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { SymbolKind } from '../packages/compiler/src/symbols/types.js';
import { nameofArgumentProblem, nameofValue, staticImportsNamed, constantFilterWarning } from '../packages/compiler/src/binder/csharp6.js';

// SF-A02-T61: nameof, using static and exception filters. The Roslyn-pinned programs are the `nameof`,
// `using-static` and `exception-filters` fixtures of packages/compiler/test/differential; these tests cover the
// pure rules and the boundaries.

/** The expression syntax of `text`, taken from the argument of a call in a parsed program. */
function expressionOf(text) {
  const file = parse(new SourceText(`class P { void M() { F(${text}); } }`, 'a.cs'));
  let found = null;
  const visit = node => {
    if (found) return;
    if (node.kind === 'Argument') {
      found = node.expression;
      return;
    }
    for (const child of node.childNodes?.() ?? []) visit(child);
  };
  visit(file.syntax);
  return found;
}
const problemOf = text => {
  const expression = expressionOf(text),
    problem = nameofArgumentProblem(expression);
  return problem ? `${problem.code}:${problem.node.toString().trim()}` : null;
};
const inMain = (body, members = '') => `using System; class C { public int F = 1; public void M() { } } class P { ${members} static void Main() { ${body} } }`;
const reported = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const run = source => {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return new VirtualMachine(result.image).run().output;
};

test('A02-T61 nameof argument: names and member accesses over names are valid', () => {
  for (const text of ['x', 'List<int>', 'a.b', 'a.b.c', 'this.x', 'base.x', 'int.MaxValue', 'global::N.C.M', 'A<int>.B']) {
    assert.equal(problemOf(text), null, text);
  }
});

test('A02-T61 nameof argument: CS8081 without a name, CS8082 for a qualifier that is not one, CS8083 for an alias', () => {
  assert.equal(problemOf('x + 1'), 'CS8081:x + 1');
  assert.equal(problemOf('5'), 'CS8081:5');
  assert.equal(problemOf('typeof(C)'), 'CS8081:typeof(C)');
  assert.equal(problemOf('x.M()'), 'CS8081:x.M()');
  assert.equal(problemOf('this'), 'CS8081:this');
  assert.equal(problemOf('new C().F'), 'CS8082:new C()');
  assert.equal(problemOf('"s".Length'), 'CS8082:"s"');
  assert.equal(problemOf('a.M().b.c'), 'CS8082:a.M()');
  assert.equal(problemOf('global::C'), 'CS8083:global::C');
});

test('A02-T61 nameof value is the last identifier', () => {
  assert.equal(nameofValue(expressionOf('a.b.c')), 'c');
  assert.equal(nameofValue(expressionOf('List<int>')), 'List');
  assert.equal(nameofValue(expressionOf('@class')), 'class');
});

test('A02-T61 using static imports static members, never extension methods or instance members', () => {
  const member = (name, kind, extra = {}) => ({ name, kind, isStatic: true, ...extra });
  const type = members => ({ getMembers: name => members.filter(m => m.name === name) });
  const twice = member('Twice', SymbolKind.Method, { isExtensionMethod: true }),
    plain = member('Plain', SymbolKind.Method),
    other = member('Plain', SymbolKind.Method),
    value = member('V', SymbolKind.Field),
    value2 = member('V', SymbolKind.Field),
    instance = member('I', SymbolKind.Field, { isStatic: false });
  const a = type([twice, plain, value, instance]),
    b = type([other, value2]);
  assert.deepEqual(staticImportsNamed([a], 'Twice'), { members: [], ambiguous: null });
  assert.deepEqual(staticImportsNamed([a], 'I'), { members: [], ambiguous: null });
  assert.deepEqual(staticImportsNamed([a, b], 'Plain'), { members: [plain, other], ambiguous: null });
  assert.deepEqual(staticImportsNamed([a], 'V'), { members: [value], ambiguous: null });
  assert.deepEqual(staticImportsNamed([a, b], 'V').ambiguous, [value, value2]);
});

test('A02-T61 a constant filter: CS7095 when true, CS8360 when false and alone, CS8359 otherwise', () => {
  assert.equal(constantFilterWarning(true, true), 'CS7095');
  assert.equal(constantFilterWarning(true, false), 'CS7095');
  assert.equal(constantFilterWarning(false, true), 'CS8360');
  assert.equal(constantFilterWarning(false, false), 'CS8359');
});

test('A02-T61 nameof names instance members from a static context and runs on the bytecode VM', () => {
  const source = inMain('int local = 1; Console.WriteLine(nameof(local) + local + nameof(C.F) + nameof(C.M) + nameof(inst) + nameof(P.inst));', 'int inst = 1;');
  assert.equal(run(source), 'local1FMinstinst\n');
});

test('A02-T61 nameof with another number of arguments is a call to a method that does not exist', () => {
  assert.deepEqual(reported(inMain('var f = nameof();')), ['CS0103:nameof']);
  assert.deepEqual(reported(inMain('int x = 1; var g = nameof(x, x);')), ['CS0103:nameof']);
});

test('A02-T61 the language-version gates of nameof are reported where Roslyn reports them', () => {
  const plain = inMain('Console.WriteLine(nameof(C));');
  assert.deepEqual(reported(plain, { langVersion: '5' }), ['CS8026:nameof(C)']);
  const through = inMain('Console.WriteLine(nameof(text.Length));', 'string text = "x";');
  assert.deepEqual(reported(through, { langVersion: '11' }), ['CS9058:text']);
  assert.deepEqual(reported(through, { langVersion: '12' }), []);
});

test('A02-T61 a filter whose timing cannot be observed runs: evaluated in the handler, a rejected one rethrows', () => {
  const source = inMain(
    'int limit = 2; try { throw new Exception("a"); } ' +
      'catch (Exception e) when (e.Message == "b") { Console.WriteLine("first"); } ' +
      'catch (Exception e) when (limit > 1 && e.Message == "a") { Console.WriteLine("second " + e.Message); }',
  );
  const result = compile(source);
  assert.equal(result.success, true, result.diagnostics.map(d => d.code + ' ' + d.message).join('; '));
  assert.equal(new VirtualMachine(result.image, { maxInstructions: 1_000_000 }).run().output, 'second a\n');
});

test('A02-T61 a filter that could tell when it runs is SF2200: calls, division, variables a finally block or a lambda changes', () => {
  const refused = [
    'try { } catch (Exception e) when (e.Message.Length == 1) { }',
    'try { } catch (Exception e) when (Check()) { }',
    'int k = 0; try { } catch (Exception e) when (1 / k == 0) { }',
    'int k = 0; try { try { } finally { k = 1; } } catch (Exception e) when (k == 1) { }',
    'int k = 0; Action a = () => k++; try { a(); } catch (Exception e) when (k == 1) { }',
  ];
  for (const body of refused) {
    const source = `using System; class P { static bool Check() { return true; } static void Main() { ${body} } }`;
    const result = compile(source);
    assert.equal(result.success, false, body);
    assert.equal(result.image, null, body);
    assert.match(result.diagnostics.find(d => d.code === 'SF2200').message, /an exception filter that calls code.*no filter handlers/, body);
  }
  // A variable assigned in the try body itself is fine: that happens before the throw in both orders.
  const body = 'int k = 0; try { k = 1; throw new Exception("x"); } catch (Exception e) when (k == 1) { Console.WriteLine(k); }';
  assert.equal(compile(`using System; class P { static void Main() { ${body} } }`).success, true);
});
