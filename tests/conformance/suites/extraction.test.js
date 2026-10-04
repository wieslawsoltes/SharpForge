import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokens,
  stringValue,
  constant,
} from '../../../scripts/conformance/suites/shared/csharp.js';
import { extractRoslyn } from '../../../scripts/conformance/suites/roslyn-import.js';
import {
  adaptRuntime,
  opcodeFamilies,
} from '../../../scripts/conformance/suites/runtime-il-import.js';
import { adaptFacts } from '../../../scripts/conformance/suites/libraries-import.js';
import {
  annotations,
  adaptExample,
} from '../../../scripts/conformance/suites/spec-examples.js';
import {
  caseStatus,
  summarize,
} from '../../../scripts/conformance/suites/run.js';
const provenance = {
  repository: 'fixture',
  commit: 'a'.repeat(40),
  path: 'Fixture.cs',
  sha256: 'b'.repeat(64),
};

test('literal extraction preserves escapes, raw indentation and rejects interpolation', () => {
  assert.equal(stringValue('@"a""b"'), 'a"b');
  assert.equal(stringValue('"a\\n\\u0042"'), 'a\nB');
  assert.equal(stringValue('"""\n  one\n  two\n  """'), 'one\ntwo');
  assert.throws(
    () => constant(tokens('$"class {name}"'), 0, 2),
    /constant|string/,
  );
  assert.throws(() => tokens('class C {'), /Unbalanced/);
});
test('Roslyn cases bind sources and exact expected diagnostic multiset to an invocation', () => {
  const input = `public void Positive() { var source = "class C {}";
    CreateCompilation(source, parseOptions: TestOptions.Regular12).VerifyDiagnostics(); }
    public void Negative() { var c = CreateCompilation("class C { void M(){ x; } }");
    c.VerifyDiagnostics(Diagnostic(ErrorCode.ERR_NameNotInContext, "x").WithArguments("x")); }`;
  const { cases, skipped } = extractRoslyn(
    input,
    { ERR_NameNotInContext: 103 },
    provenance,
  );
  assert.equal(cases.length, 2);
  assert.equal(skipped.length, 0);
  assert.equal(cases[0].langVersion, '12');
  assert.equal(cases[1].langVersion, 'preview');
  assert.deepEqual(cases[1].expected.diagnostics, [
    { code: 'CS0103', severity: 'error' },
  ]);
  assert.match(cases[1].expectationText, /WithArguments/);
});
test('Roslyn dynamic expectations and unresolved helper source are not fabricated cases', () => {
  const text =
    'public void X() { CreateCompilation(GetSource()).VerifyDiagnostics(); CreateCompilation("class C {}").VerifyDiagnostics(expected); }';
  const extracted = extractRoslyn(text, {}, provenance);
  assert.equal(extracted.cases.length, 0);
  assert.equal(extracted.skipped.length, 2);
});
test('runtime adaptation retains test body and unsupported dependencies explicitly', () => {
  const input =
    'using Xunit; class C { [Fact] public static int TestEntryPoint() { return 100; } }';
  const actual = adaptRuntime(input, '.cs');
  assert.match(actual.sourceText, /static int Main\(\) \{ return 100;/);
  assert.deepEqual(actual.unsupported, []);
  assert(
    adaptRuntime(
      '.assembly extern legacy library mscorlib {} .entrypoint',
      '.il',
    ).unsupported.length,
  );
  assert.deepEqual(
    opcodeFamilies('ldc.i4.0\nadd\nbrfalse.s END\nconv.i8\nret\n'),
    ['arithmetic', 'branches', 'calls', 'conversions'],
  );
});
test('xunit adaptation accepts scalar facts but preserves theory/helper/assertion limitations', () => {
  const source =
    '[Fact] public void Good() { Assert.Equal(1, 1); } [Theory] public void Data(int x) { Assert.True(x > 0); } [Fact] public void Sequence() { Assert.Empty(new int[0]); }';
  const rows = adaptFacts(
    source,
    provenance,
    'System.Runtime',
    'namespace Xunit {}',
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].unsupported.length, 0);
  assert.match(rows[1].unsupported.join(), /Parameterized/);
  assert.match(rows[2].unsupported.join(), /Assert.Empty/);
});
test('annotated specification examples preserve negative contracts and block ellipsis substitution', () => {
  const text =
    '> <!-- Example: {template:"standalone-lib", name:"Negative", expectedErrors:["CS0103"]} -->\n> ```csharp\n> class C {}\n> ```';
  const rows = annotations(text);
  assert.equal(rows.length, 1);
  assert.deepEqual(adaptExample(rows[0]).expected.diagnostics, [
    { code: 'CS0103', severity: 'error' },
  ]);
  assert(
    adaptExample({
      metadata: { template: 'standalone-lib', replaceEllipsis: true },
      sourceText: '...',
    }).unsupported.length,
  );
});
test('reports never count unknown, unexecuted or unsupported observations as passing', () => {
  assert.equal(caseStatus([]), 'unmeasured');
  assert.equal(caseStatus([{ status: 'pass' }, { status: 'fail' }]), 'fail');
  assert.equal(
    caseStatus([{ status: 'pass' }, { status: 'unsupported' }]),
    'unsupported',
  );
  assert.deepEqual(
    summarize(
      [
        { langVersion: '12', status: 'pass' },
        { langVersion: '12', status: 'fail' },
        { langVersion: '12', status: 'unsupported' },
      ],
      'langVersion',
    )['12'],
    { pass: 1, fail: 1, unsupported: 1, unmeasured: 0, passRate: 0.5 },
  );
});
