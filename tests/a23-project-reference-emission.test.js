import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { AssemblyInspector, emitAssemblyDetailed, loadAssembly, sha256 } from '@sharpforge/cil';
import { Op, verifyImage, projectReferenceLimits } from '@sharpforge/bytecode';

const counterSource = `public class Counter {
  public static int Total;
  public int Field;
  public int Value { get; set; }
  public Counter(int value) { Value = value; Field = value; }
  public void Add(int value) { Value += value; }
  public static int Answer() { return 42; }
}`;
const digest = bytes => Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
const reference = (bytes, extras = {}) => ({ bytes, runtimeProfile: 'sharpforge', ...extras });

function library(name = 'Library', source = counterSource) {
  const result = compileToIL(source, { name, outputKind: 'library', assemblyVersion: '1.0.0.0' });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result.assembly;
}

test('project reference lowering keeps external identities out of local definitions and retains native member tokens', () => {
  const bytes = library();
  const result = compile(`var counter = new Counter(40); counter.Add(2);
    counter.Field += 2; Counter.Total = counter.Field;
    counter.Value = Counter.Total; System.Console.WriteLine(counter.Value);`,
  { name: 'App', references: [reference(bytes)] });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(verifyImage(result.image), []);
  const descriptors = result.image.externalReferences;
  assert.equal(descriptors.format, 'SharpForge.ProjectReferences/1');
  assert.equal(descriptors.assemblies.length, 1);
  assert.equal(descriptors.assemblies[0].sha256, digest(bytes));
  assert.deepEqual(descriptors.assemblies[0].identity, { name: 'Library', version: [1, 0, 0, 0],
    cultureName: '', publicKeyToken: '', isRetargetable: false, contentType: 'default' });
  const type = descriptors.types.find(item => item.name === 'Counter');
  assert.equal(type.imageName, '[' + descriptors.assemblies[0].key + ']Counter');
  assert.equal(result.image.types.some(item => item.name.includes('Counter')), false);
  assert.equal(result.image.methods.some(item => item.owner?.includes('Counter')), false);
  const inspector = new AssemblyInspector(bytes);
  const constructor = descriptors.methods.find(method => method.name === '.ctor');
  assert.equal(inspector.resolveToken(constructor.token).name, '.ctor');
  assert.equal(constructor.isStatic, false);
  assert.deepEqual(constructor.parameters, ['int']);
  const opcodes = result.image.methods.flatMap(method => Array.from({ length: method.code.length / 3 }, (_, index) => method.code[index * 3]));
  for (const opcode of [Op.EXTNEWOBJ, Op.EXTCALL, Op.EXTLDFLD, Op.EXTSTFLD, Op.EXTLDSTATIC, Op.EXTSTSTATIC]) {
    assert(opcodes.includes(opcode), 'Missing external reference opcode ' + opcode);
  }
});

test('emitted project consumers contain AssemblyRef and MemberRef rows with no copied dependency definitions', () => {
  const bytes = library();
  const result = compileToIL('var c = new Counter(40); c.Add(2); System.Console.WriteLine(c.Value);',
    { name: 'App', references: [reference(bytes)] });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const inspector = new AssemblyInspector(result.assembly);
  assert.equal(inspector.types.some(type => type.name === 'Counter'), false);
  assert(inspector.summary({ includeMethods: false }).references.some(item => item.name === 'Library'));
  const calls = [...inspector.methods.values()].flatMap(method => inspector.getMethod(method.token).instructions)
    .filter(instruction => ['call', 'callvirt', 'newobj'].includes(instruction.name))
    .map(instruction => inspector.resolveToken(instruction.operand));
  for (const name of ['.ctor', 'Add', 'get_Value']) {
    assert(calls.some(call => call.token >>> 24 === 10 && call.name === name && call.owner === 'Counter'), name);
  }
  const unlinked = loadAssembly(result.assembly);
  assert.deepEqual(unlinked.externalReferences, result.image.externalReferences);
  assert.equal(unlinked.types.some(type => type.name.includes('Counter')), false);
});

test('an intermediate library with project references remains a library without an invented entry point', () => {
  const upstream = library();
  const result = compileToIL('public class Middle { public static int Answer() { return Counter.Answer(); } }',
    { name: 'Middle', outputKind: 'library', references: [reference(upstream)] });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.image.outputKind, 'library');
  assert.equal(result.image.entryPoint, null);
  assert.equal(new AssemblyInspector(result.assembly).pe.entryPoint, 0);
  assert.equal(result.image.externalReferences.assemblies[0].identity.name, 'Library');
  assert(result.image.methods.some(method => method.name === 'Answer'));
});

test('extern aliases keep identical dependency type names distinct through assembly-qualified image types', () => {
  const left = library('Left');
  const right = library('Right');
  const result = compile('extern alias A; extern alias B; class P { static void Main() { '
    + 'var a = new A::Counter(20); var b = new B::Counter(22); System.Console.WriteLine(a.Value + b.Value); } }',
  { name: 'App', references: [reference(left, { aliases: ['A'] }), reference(right, { aliases: ['B'] })] });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const descriptors = result.image.externalReferences;
  assert.equal(descriptors.assemblies.length, 2);
  assert.equal(descriptors.types.length, 2);
  assert.equal(new Set(descriptors.types.map(type => type.imageName)).size, 2);
  assert(descriptors.types.every(type => type.name === 'Counter'));
});

test('a runtime-profile marker never admits a PE without canonical SharpForge method verification', () => {
  const compiled = compile(counterSource, { name: 'Library', outputKind: 'library' });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const bytes = emitAssemblyDetailed(compiled.image, { includeDebug: false, name: 'Library' }).bytes;
  const result = compile('System.Console.WriteLine(Counter.Answer());', { references: [reference(bytes)] });
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'SF2200' && item.message.includes('canonical SharpForge profile')),
    JSON.stringify(result.diagnostics));
  const strict = compile('System.Console.WriteLine(Counter.Answer());', { references: [{ bytes: library() }] });
  assert.equal(strict.success, false);
  assert(strict.diagnostics.some(item => item.code === 'CS0518'), JSON.stringify(strict.diagnostics));
});

test('supplied project-reference count is bounded even when identities would coalesce', () => {
  const bytes = library();
  const references = Array.from({ length: projectReferenceLimits.assemblies + 1 }, () => reference(bytes));
  const result = compile('System.Console.WriteLine(Counter.Answer());', { references });
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'SF2200' && item.message.includes('too many supplied project assemblies')),
    JSON.stringify(result.diagnostics));
});
