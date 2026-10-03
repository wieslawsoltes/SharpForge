import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { collectUsingDirectives } from '../packages/compiler/src/binder/usings.js';
import { typeSyntaxSpan } from '../packages/compiler/src/binder/type-spans.js';
import {
  NullableContextMap,
  annotate,
  encodeNullableFlags,
  decodeNullableFlags,
  nullableContextFlag,
  nullableAttributeFor,
  compactNullableFlags,
} from '../packages/compiler/src/nullable/annotations.js';
import { pragmaDirectivesFromSyntax, applySuppression } from '../packages/compiler/src/diagnostics/suppression.js';
import { frameworkBridge } from '../packages/compiler/src/symbols/registry-bridge.js';
import { ArrayTypeSymbol, NullableAnnotation, TypeWithAnnotations } from '../packages/compiler/src/symbols/types.js';

const slice = (source, d) => source.slice(d.start, d.start + d.length);
const inMain = body => `class Program { static void Main() { ${body} } }`;

test('A02-B01 parser-level feature gating is active in Compilation.build', () => {
  // The four gaps the bug names: var at 2, interpolated strings at 5, switch expressions and ??= at 7.
  const rows = [
    ['var x = 1; Console.WriteLine(x);', '2', 'CS8023', 'var'],
    ['int a = 1; Console.WriteLine($"{a}");', '5', 'CS8026', '$"{a}"'],
    ['int a = 1; Console.WriteLine(a switch { 1 => 2 });', '7', 'CS8107', 'switch'],
    ['string s = null; s ??= "x"; Console.WriteLine(s);', '7', 'CS8107', '??='],
  ];
  for (const [body, langVersion, code, text] of rows) {
    const source = inMain(body);
    const d = compile(source, { langVersion }).diagnostics.filter(x => x.code === code);
    assert.equal(d.length, 1, source);
    assert.equal(slice(source, d[0]), text);
    assert.equal(d[0].severity, 'error');
    assert.equal(compile(source, { langVersion }).success, false);
    assert.equal(
      compile(source).diagnostics.some(x => x.code === code),
      false,
    );
  }
  // Roslyn gates a discard pattern next to the switch expression that contains it ('recursive patterns').
  const discard = inMain('int a = 1; Console.WriteLine(a switch { _ => 2 });');
  assert.deepEqual(
    compile(discard, { langVersion: '7' })
      .diagnostics.filter(x => x.code === 'CS8107')
      .map(d => slice(discard, d)),
    ['switch', '_'],
  );
  // A feature the binder gates itself is reported once.
  assert.equal(
    compile(inMain('object o = 1; Exception e = new("x"); Console.WriteLine(e.Message);'), { langVersion: '8' }).diagnostics.filter(
      d => d.code === 'CS8400',
    ).length,
    1,
  );
  // Per-file versions select the gate per file.
  const files = [
    { uri: 'a.cs', text: 'class A{public static string F(int a){return $"{a}";}}' },
    { uri: 'b.cs', text: 'Console.WriteLine(A.F(1));' },
  ];
  assert.deepEqual(
    compile(files, { langVersionByUri: { 'a.cs': '5' } }).diagnostics.map(d => d.code + ':' + d.uri),
    ['CS8026:a.cs'],
  );
  const topLevel = compile(files, { langVersionByUri: { 'b.cs': '5' } });
  assert.equal(topLevel.success, false);
  assert.deepEqual(topLevel.diagnostics.map(d => d.code + ':' + d.uri), ['CS8026:b.cs']);
});
test('A02-B01 parser-detectable features report the Roslyn code of the selected version and nothing at their own version', () => {
  // [source, introduced in, a version below it, the code Roslyn reports at that lower version]
  const rows = [
    ['var x = 1;', 3, '2', 'CS8023'],
    ['int a=1; string s=$"{a}";', 6, '5', 'CS8026'],
    ['int a=1; int b=a switch{_=>2};', 8, '7.3', 'CS8370'],
    ['string s=null; s??="x";', 8, '7', 'CS8107'],
    ['Exception e=new("x");', 9, '8', 'CS8400'],
    ['int[] a=[1];', 12, '11', 'CS9058'],
    ['string s="""x""";', 11, '10', 'CS8936'],
    ['class C{int M()=>1;}', 6, '5', 'CS8026'],
    ['int x=default;', 7.1, '7', 'CS8107'],
    ['int x=1_000;', 7, '6', 'CS8059'],
    ['int x=0b1;', 7, '6', 'CS8059'],
    ['string s=null; s??="x";', 8, '7.1', 'CS8302'],
    ['string s=null; s??="x";', 8, '7.2', 'CS8320'],
    ['var x = 1;', 3, 'iso-2', 'CS8023'],
    ['var x = 1;', 3, '1', 'CS8022'],
    ['int[] a=[1];', 12, '9', 'CS8773'],
  ];
  const gate = /^CS(?:802[2-6]|8059|8107|8302|8320|8370|8400|8773|8936|9058|9202|9260|9327)$/;
  for (const [body, version, below, code] of rows) {
    const source = body.startsWith('class ') ? body : inMain(body);
    assert(
      compile(source, { langVersion: below, outputKind: 'library' }).diagnostics.some(d => d.code === code && d.severity === 'error'),
      `${source} at ${below} reports ${code}`,
    );
    assert.equal(
      compile(source, { langVersion: String(version), outputKind: 'library' }).diagnostics.some(d => gate.test(d.code)),
      false,
      source + ' at ' + version,
    );
  }
});
test('A02-T24 using directives, namespaces and aliases are read from the syntax tree', () => {
  const source =
    'global using System;\nusing Txt = System.Text;\nusing static System.Math;\n' +
    'namespace A.B { using System.Collections.Generic; namespace C { using L = System.Collections.Generic.List<int>; } }\n' +
    '// using Fake;\nclass X{void M(){using(var d=new D()){} string s="using Nope;";}}\n';
  const file = parse(new SourceText(source, 'u.cs')),
    list = collectUsingDirectives(file);
  assert.deepEqual(
    list.map(u => [u.kind, u.name, u.alias, u.isGlobal, u.namespace]),
    [
      ['namespace', 'System', null, true, ''],
      ['alias', 'System.Text', 'Txt', false, ''],
      ['static', 'System.Math', null, false, ''],
      ['namespace', 'System.Collections.Generic', null, false, 'A.B'],
      ['alias', 'System.Collections.Generic.List<int>', 'L', false, 'A.B.C'],
    ],
  );
  for (const u of list) {
    assert.equal(u.uri, 'u.cs');
    assert.equal(source.slice(u.nameStart, u.nameEnd).replace(/\s/g, ''), u.name.replace(/\s/g, ''));
    assert.equal(source[u.end - 1], ';');
    assert.equal(u.syntax.kind, 'UsingDirective');
  }
  assert.equal(source.slice(list[0].start, list[0].start + 12), 'global using');
  // The token fallback (a file without a syntax tree) agrees on the plain forms.
  const plain = collectUsingDirectives({ source: file.source, tokens: file.tokens, root: file.root });
  assert.deepEqual(
    plain.map(u => [u.kind, u.name, u.alias]),
    list.map(u => [u.kind, u.name, u.alias]),
  );
  // File-scoped namespaces scope the usings that follow them.
  assert.deepEqual(
    collectUsingDirectives(parse(new SourceText('namespace N;\nusing System.Text;\nclass C{}'))).map(u => [u.name, u.namespace]),
    [['System.Text', 'N']],
  );
});
test('A02-T24 type-name diagnostics are reported on the type syntax', () => {
  const source = 'Foo x = null; Bar[] y = null; class C{ Baz f; Qux M(Zed p, int[] q){return null;} }';
  const d = compile(source)
    .diagnostics.filter(x => x.code === 'CS0246')
    .map(x => slice(source, x) + ':' + x.message.match(/'([^']+)'/)[1])
    .sort();
  assert.deepEqual(d, ['Bar:Bar', 'Baz:Baz', 'Foo:Foo', 'Qux:Qux', 'Zed:Zed']);
  const file = parse(new SourceText('class C{ System.Collections.Generic.List<int> M(string[] a){ int[] b=null; return null; } }'));
  const method = file.root.members[0].members[0],
    text = n => file.source.text.slice(n.start, n.end);
  assert.equal(text(typeSyntaxSpan(file.syntax, method, method.returnType)), 'System.Collections.Generic.List<int>');
  assert.equal(text(typeSyntaxSpan(file.syntax, method.parameters[0], 'string[]')), 'string');
  assert.equal(text(typeSyntaxSpan(file.syntax, method.body.statements[0].declarations[0], 'int[]')), 'int');
  assert.equal(typeSyntaxSpan(file.syntax, method, 'Nope'), null);
  assert.equal(typeSyntaxSpan(null, method, 'int'), null);
  const files = [
    { uri: 'a.cs', text: 'namespace A{public class Item{}}namespace B{public class Item{}}' },
    { uri: 'p.cs', text: 'using A; using B; class K{ Item f; }' },
  ];
  const ambiguous = compile(files, { outputKind: 'library' }).diagnostics.find(x => x.code === 'CS0104');
  assert.equal(files[1].text.slice(ambiguous.start, ambiguous.start + ambiguous.length), 'Item');
});
test('A02-T37 #pragma warning reaches the final diagnostic list end to end', () => {
  const body =
    'int a;\n#pragma warning disable CS0168\nint b;\n#pragma warning restore CS0168\nint c;\n' +
    '#pragma warning disable 168, 219\nint d; int e = 1;\n#pragma warning restore\nint f;\n';
  const names = (source, options) => compile(source, options).diagnostics.map(d => d.code + ':' + slice(source, d));
  assert.deepEqual(names(body), ['CS0168:a', 'CS0168:c', 'CS0168:f']);
  // warnaserror does not resurrect a pragma-disabled warning; an enabled one becomes an error.
  const promoted = compile(body, { warnAsError: ['CS0168'] });
  assert.equal(promoted.success, false);
  assert.deepEqual(
    promoted.diagnostics.map(d => slice(body, d) + ':' + d.severity),
    ['a:error', 'c:error', 'f:error'],
  );
  // A directive in an inactive #if region has no effect; defining the symbol activates it.
  const conditional = '#if QUIET\n#pragma warning disable CS0168\n#endif\nint a;\n';
  assert.deepEqual(names(conditional), ['CS0168:a']);
  assert.deepEqual(compile(conditional, { preprocessorSymbols: ['QUIET'] }).diagnostics, []);
  assert.deepEqual(compile(conditional, { preprocessorSymbols: 'DEBUG;QUIET' }).diagnostics, []);
  // The directives come from the syntax tree, not from a second scan of the text.
  const parsed = parse(new SourceText(body));
  assert.deepEqual(
    pragmaDirectivesFromSyntax(parsed.directives).map(d => [d.action, d.ids]),
    [
      ['disable', ['CS0168']],
      ['restore', ['CS0168']],
      ['disable', ['CS0168', 'CS0219']],
      ['restore', null],
    ],
  );
  const fake = [{ uri: 'x.cs', start: 50, length: 1, code: 'CS0168', message: '', severity: 'warning' }],
    directive = isActive =>
      new Map([
        ['x.cs', [{ start: 0, end: 10, structure: { isActive, directive: 'pragma', pragma: 'warning', action: 'disable', codes: [] } }]],
      ]);
  assert.deepEqual(applySuppression(fake, { sources: new Map([['x.cs', 'int a;']]), directives: directive(true) }), []);
  assert.equal(applySuppression(fake, { sources: new Map([['x.cs', 'int a;']]), directives: directive(false) }).length, 1);
  // Both pipelines agree.
  assert.equal(compile(body, { pipeline: 'verify' }).success, true);
});
test('A02-T05.3 #nullable directives and /nullable define the context per position', () => {
  const source =
    'class A{}\n#nullable enable\nclass B{}\n#nullable disable warnings\nclass C{}\n#nullable restore\nclass D{}\n#nullable enable annotations\nclass E{}\n';
  const file = parse(new SourceText(source)),
    at = name => source.indexOf('class ' + name),
    map = new NullableContextMap(file.directives, 'disable');
  assert.deepEqual(
    ['A', 'B', 'C', 'D', 'E'].map(n => {
      const s = map.stateAt(at(n));
      return (s.annotations ? 'a' : '-') + (s.warnings ? 'w' : '-');
    }),
    ['--', 'aw', 'a-', '--', 'a-'],
  );
  const enabled = new NullableContextMap(file.directives, 'enable');
  assert.deepEqual({ ...enabled.stateAt(at('A')) }, { annotations: true, warnings: true });
  assert.deepEqual({ ...enabled.stateAt(at('D')) }, { annotations: true, warnings: true });
  assert.equal(map.anyWarnings, true);
  assert.equal(new NullableContextMap([], 'annotations').anyWarnings, false);
  assert.equal(new NullableContextMap([], 'warnings').warningsEnabledAt(0), true);
  // A directive in an inactive region does not count.
  assert.equal(
    new NullableContextMap(parse(new SourceText('#if X\n#nullable enable\n#endif\nclass A{}')).directives).stateAt(40).annotations,
    false,
  );
});
test('A02-T05.3 annotations encode to NullableAttribute bytes and round-trip', () => {
  const bridge = frameworkBridge(),
    string = bridge.typeFromName('string'),
    int = bridge.typeFromName('int'),
    nullable = bridge.coreType('System_Nullable_T'),
    enumerable = bridge.coreType('System_Collections_Generic_IEnumerable_T');
  assert.equal(annotate(string, true, true).nullableAnnotation, NullableAnnotation.Annotated);
  assert.equal(annotate(string, false, true).nullableAnnotation, NullableAnnotation.NotAnnotated);
  assert.equal(annotate(string, false, false).nullableAnnotation, NullableAnnotation.Oblivious);
  assert.equal(annotate(string, true, false).nullableAnnotation, NullableAnnotation.Annotated);
  assert.deepEqual(encodeNullableFlags(annotate(string, true, true)), [2]);
  assert.deepEqual(encodeNullableFlags(annotate(int, false, true)), []);
  assert.deepEqual(encodeNullableFlags(new TypeWithAnnotations(nullable.construct(int))), [0]);
  // IEnumerable<string?>[]? written in an enabled context: array annotated, IEnumerable not annotated, string annotated.
  const element = new TypeWithAnnotations(enumerable.construct(annotate(string, true, true)), NullableAnnotation.NotAnnotated),
    array = new TypeWithAnnotations(new ArrayTypeSymbol(element), NullableAnnotation.Annotated);
  assert.deepEqual(encodeNullableFlags(array), [2, 1, 2]);
  const stripped = new ArrayTypeSymbol(enumerable.construct(string)),
    decoded = decodeNullableFlags(stripped, [2, 1, 2]);
  assert.equal(decoded.toDisplayString(), array.toDisplayString());
  assert.deepEqual(encodeNullableFlags(decoded), [2, 1, 2]);
  assert.deepEqual(encodeNullableFlags(decodeNullableFlags(stripped, [1])), [1, 1, 1]);
  assert.deepEqual(encodeNullableFlags(decodeNullableFlags(stripped, null, 2)), [2, 2, 2]);
  assert.deepEqual(compactNullableFlags([1, 1, 1]), [1]);
  assert.deepEqual(compactNullableFlags([1, 2]), [1, 2]);
  assert.equal(nullableContextFlag([[1], [1, 2], [2, 1]]), 1);
  assert.equal(nullableContextFlag([]), 0);
  assert.deepEqual(nullableAttributeFor(annotate(string, false, true), 1), { nullable: null });
  assert.deepEqual(nullableAttributeFor(annotate(string, true, true), 1), { nullable: [2] });
});
