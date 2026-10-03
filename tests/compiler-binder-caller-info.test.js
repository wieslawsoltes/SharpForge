import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { SymbolKind } from '../packages/compiler/src/symbols/types.js';
import { MethodKind } from '../packages/compiler/src/symbols/members.js';
import { callerMemberName, callerInfoArguments } from '../packages/compiler/src/binder/caller-info.js';

// SF-A02-T57: caller info attributes. The Roslyn-pinned programs are the `caller-info` fixtures of
// packages/compiler/test/differential; these tests cover the pure rules and the boundaries.

const compilerServices = { name: 'CompilerServices', containingSymbol: { name: 'Runtime', containingSymbol: { name: 'System' } } };
const attribute = (name, argument) => ({
  attributeClass: { name, containingSymbol: compilerServices },
  arguments: argument === undefined ? [] : [{ constantValue: { value: argument } }],
});
const parameter = (name, ordinal, attributes = [], isOptional = attributes.length > 0) => ({ name, ordinal, isOptional, boundAttributes: attributes });
const method = (...parameters) => ({ parameters });
const site = { member: { kind: SymbolKind.Method, methodKind: MethodKind.Ordinary, name: 'Run' }, line: 12, path: 'a.cs' };

const header = 'using System; using System.Runtime.CompilerServices; ';
function run(source) {
  const result = compile(header + source);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message),
    [],
  );
  const il = compileToIL(header + source, { includeDebug: false });
  assert.equal(il.success, true);
  const output = new VirtualMachine(result.image).run().output;
  assert.equal(new CilVirtualMachine(il.assembly).run().output, output);
  return output;
}

test('A02-T57 the member name of a method, accessor, constructor, operator and initialized field', () => {
  const symbol = (methodKind, name, extra = {}) => ({ kind: SymbolKind.Method, methodKind, name, ...extra });
  assert.equal(callerMemberName(symbol(MethodKind.Ordinary, 'Run')), 'Run');
  assert.equal(callerMemberName(symbol(MethodKind.Constructor, '.ctor')), '.ctor');
  assert.equal(callerMemberName(symbol(MethodKind.StaticConstructor, '.cctor')), '.cctor');
  assert.equal(callerMemberName(symbol(MethodKind.Destructor, 'Finalize')), 'Finalize');
  assert.equal(callerMemberName(symbol(MethodKind.UserDefinedOperator, 'op_Addition')), 'op_Addition');
  const getter = symbol(MethodKind.PropertyGet, 'get_Count', { isAccessor: true, associatedSymbol: { name: 'Count' } });
  assert.equal(callerMemberName(getter), 'Count');
  const indexerGetter = symbol(MethodKind.PropertyGet, 'get_Item', { isAccessor: true, associatedSymbol: { name: 'this[]', isIndexer: true } });
  assert.equal(callerMemberName(indexerGetter), 'Item');
  assert.equal(callerMemberName({ kind: SymbolKind.Field, name: 'field' }), 'field');
  // Top-level statements run in the synthesized entry point.
  assert.equal(callerMemberName(null), '<Main>$');
});

test('A02-T57 only omitted arguments get caller info; the line number wins over the other attributes', () => {
  const m = method(
    parameter('text', 0),
    parameter('member', 1, [attribute('CallerMemberNameAttribute')]),
    parameter('line', 2, [attribute('CallerMemberNameAttribute'), attribute('CallerLineNumberAttribute')]),
    parameter('path', 3, [attribute('CallerFilePathAttribute')]),
  );
  assert.deepEqual([...callerInfoArguments(m, [0], [null], site)], [[1, 'Run'], [2, 12], [3, 'a.cs']]);
  assert.deepEqual([...callerInfoArguments(m, [0, 1, 3], [null, null, null], site)], [[2, 12]]);
});

test('A02-T57 a parameter without a default value receives nothing', () => {
  const m = method(parameter('member', 0, [attribute('CallerMemberNameAttribute')], false));
  assert.deepEqual([...callerInfoArguments(m, [], [], site)], []);
});

test('A02-T57 CallerArgumentExpression passes the text of the argument of the named parameter', () => {
  const text = source => ({ toString: () => source });
  const m = method(parameter('condition', 0), parameter('expression', 1, [attribute('CallerArgumentExpressionAttribute', 'condition')]));
  assert.deepEqual([...callerInfoArguments(m, [0], [text(' a   ==  2 ')], site)], [[1, 'a   ==  2']]);
  // An unknown or self-referential name passes nothing: the declared default is used.
  const unknown = method(parameter('x', 0), parameter('e', 1, [attribute('CallerArgumentExpressionAttribute', 'nope')]));
  assert.deepEqual([...callerInfoArguments(unknown, [0], [text('1')], site)], []);
  const self = method(parameter('e', 0, [attribute('CallerArgumentExpressionAttribute', 'e')]));
  assert.deepEqual([...callerInfoArguments(self, [], [], site)], []);
});

test('A02-T57 caller info runs on both back ends: methods, lambdas, local functions, constructors', () => {
  const source =
    'class T { public string Who; public T([CallerMemberName] string who = "?") { Who = who; } } ' +
    'class P { static string Name([CallerMemberName] string who = "?", [CallerLineNumber] int line = 0) { return who + line; } ' +
    'static void Main() { Console.WriteLine(Name()); Func<string> f = () => Name(); Console.WriteLine(f()); ' +
    'string Local() { return Name(); } Console.WriteLine(Local()); Console.WriteLine(new T().Who + new T("given").Who + Name("x", 5)); } }';
  assert.equal(run(source), 'Main1\nMain1\nMain1\nMaingivenx5\n');
});

test('A02-T57 the line number is the line of the called name', () => {
  const source =
    'class P { static int Line([CallerLineNumber] int line = 0) { return line; }\n' +
    'static void Main() {\n' +
    'Console.WriteLine(Line());\n' +
    'Console.WriteLine(P\n.Line());\n' +
    '} }';
  assert.equal(run(source), '3\n5\n');
});

test('A02-T57 declaration rules are reported on the attribute', () => {
  const codes = declaration => {
    const source = header + `class P { ${declaration} static void Main() { } }`;
    return compile(source)
      .diagnostics.filter(d => d.code.startsWith('CS'))
      .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
  };
  assert.deepEqual(codes('static void A([CallerLineNumber] string line = "") { }'), ['CS4017:CallerLineNumber']);
  assert.deepEqual(codes('static void B([CallerMemberName] string name) { }'), ['CS4022:CallerMemberName']);
  assert.deepEqual(codes('static void C([CallerLineNumber] long ok = 0, [CallerLineNumber] object box = null) { }'), []);
});

test('A02-T57 a caller info value for a parameter type the image cannot hold is SF2200, never a wrong value', () => {
  const source = header + 'class P { static void L([CallerLineNumber] long line = 0) { } static void Main() { L(); } }';
  const result = compile(source);
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert(result.diagnostics.some(d => d.code === 'SF2200'));
});
