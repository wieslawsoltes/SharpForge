import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { AssemblyInspector, decodeCoded, FieldAttributes } from '@sharpforge/cil';
import { compile, compileToAssembly, createReferenceSet } from '@sharpforge/compiler';
import { loadReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';
import { loadFixtures, referenceFixtureDirectory } from '../packages/compiler/test/cil-emission/harness.js';
import { dotnetHost, sdkVersion, openDotnetScratch, runFixtureOnDotnet } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const pack = loadReferencePack();
const skip = !pack && 'no .NET reference pack is installed';
const sourceOf = body => `class Program { static void Main() { ${body} } }`;
const errors = result => result.diagnostics.filter(entry => entry.severity === 'error');

function emit(source) {
  const result = compileToAssembly(source, { name: 'DynamicSample', references: pack.references });
  assert.deepEqual(errors(result).map(entry => `${entry.code}: ${entry.message}`), []);
  assert.ok(result.assembly);
  return { assembly: result.assembly, inspector: new AssemblyInspector(result.assembly) };
}

test('A02-T55 direct CIL reports the missing binder as CS0656; declarations do not require it', () => {
  const result = compileToAssembly(sourceOf('dynamic value = 1; object answer = value + 1;'));
  assert.equal(result.assembly, null);
  assert.deepEqual(errors(result).map(entry => entry.code), ['CS0656']);
  assert.match(errors(result)[0].message, /Microsoft\.CSharp\.RuntimeBinder/);
  assert.ok(compileToAssembly(sourceOf('dynamic value = 1; object answer = value;')).assembly);
});

test('A02-T55 source-image execution continues to reject dynamic operations explicitly', () => {
  const result = compile(sourceOf('dynamic value = 1; object answer = value + 1;'));
  assert.equal(result.success, false);
  assert.ok(errors(result).some(entry => entry.code === 'SF2200'));
});

test('A02-T55 runtime binder types name their defining assemblies and sites are static cached fields', { skip }, () => {
  const { inspector } = emit(sourceOf('dynamic text = "value"; int length = text.Length;'));
  const metadata = inspector.metadata;
  const types = (metadata.rows[1] ?? []).map(row => {
    const scope = decodeCoded('ResolutionScope', row[0]);
    return { name: metadata.string(row[2]) + '.' + metadata.string(row[1]), assembly: metadata.string(metadata.row(scope)[6]) };
  });
  assert.ok(types.some(type => type.name === 'Microsoft.CSharp.RuntimeBinder.Binder' && type.assembly === 'Microsoft.CSharp'));
  assert.ok(types.some(type => type.name === 'System.Runtime.CompilerServices.CallSite`1' && type.assembly === 'System.Linq.Expressions'));
  const fields = metadata.rows[4].filter(row => metadata.string(row[1]).startsWith('<>p__'));
  assert.ok(fields.length > 0);
  assert.ok(fields.every(row => row[0] & FieldAttributes.Static));
  assert.ok(inspector.types.some(type => type.name.startsWith('<>DynamicSites')));
});

test('A02-T55 ref/out arguments use a synthesized runtime delegate with by-reference slots', { skip }, () => {
  const { inspector } = emit(sourceOf('dynamic target = null; int number = 1; string label; target.Update(ref number, out label);'));
  const delegates = inspector.types.filter(type => type.name.startsWith('<>DynamicDelegate'));
  assert.ok(delegates.length > 0);
  for (const type of delegates) {
    const method = type.methods.find(candidate => candidate.name === 'Invoke');
    const parameters = inspector.getMethod(method.token).signature.parameters;
    assert.ok(parameters.some(parameter => parameter.includes('int') && parameter.includes('&')), parameters.join(', '));
    assert.ok(parameters.some(parameter => parameter.includes('string') && parameter.includes('&')), parameters.join(', '));
  }
});

test('A02-T55 ordinary assemblies without dynamic have no new runtime dependencies or synthesized caches', { skip }, () => {
  const { inspector } = emit(sourceOf('System.Console.WriteLine(1);'));
  assert.ok(!inspector.types.some(type => type.name.startsWith('<>Dynamic')));
  assert.ok(!inspector.summary().references.some(reference => reference.name === 'Microsoft.CSharp'));
});

test('A02-T55 output is deterministic for repeated compilation of the same call sites', { skip }, () => {
  const source = sourceOf('dynamic value = 4; value += 2; System.Console.WriteLine((object)value);');
  assert.deepEqual(emit(source).assembly, emit(source).assembly);
});

test('A02-T55 an explicit reference set missing Microsoft.CSharp produces a diagnostic and no assembly', { skip }, () => {
  const references = createReferenceSet(readReferenceFiles(pack.pack.files.filter(path => basename(path) !== 'Microsoft.CSharp.dll')));
  const result = compileToAssembly(sourceOf('dynamic value = 4; object answer = value + 1;'), { references });
  assert.equal(result.assembly, null);
  assert.deepEqual(errors(result).map(entry => entry.code), ['CS0656']);
});

test('A02-T55 restrictions on dynamic arguments remain binder diagnostics', { skip }, () => {
  const result = compileToAssembly(sourceOf('dynamic target = null; target.Take(x => x);'), { references: pack.references });
  assert.equal(result.assembly, null);
  assert.ok(errors(result).some(entry => entry.code === 'CS1977'));
});

const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const runtimeSkip = skip || (!sdk && 'no .NET host is installed');
const fixtures = loadFixtures(referenceFixtureDirectory).filter(fixture => ['dynamic-callsites', 'dynamic-control-flow'].includes(fixture.name));

for (const fixture of fixtures) {
  test(`A02-T55 ${fixture.name}: direct CIL matches pinned Roslyn output on real .NET`, { skip: runtimeSkip }, t => {
    assert.equal(typeof fixture.expected, 'string', 'run verify-dotnet.mjs --references --update to capture the Roslyn oracle');
    const scratch = openDotnetScratch({ dotnet, sdk, pack });
    try {
      const result = runFixtureOnDotnet(fixture, { output: fixture.expected }, scratch.context('references'));
      assert.equal(result.ok, true, result.detail);
      t.diagnostic(`.NET SDK ${sdk}, reference pack ${pack.pack.version}; image/browser runtime has no dynamic binder`);
    } finally {
      scratch.close();
    }
  });
}
