import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { readPE, readAssemblyModules, loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const versionAttribute = 'System.Reflection.AssemblyVersionAttribute';
const companyAttribute = 'System.Reflection.AssemblyCompanyAttribute';
const resource = { manifestName: 'Merge.Data.bin', bytes: Uint8Array.of(0, 127, 255) };
const keys = JSON.parse(readFileSync(new URL('./fixtures/clr-identity/public-keys.json', import.meta.url), 'utf8')).cases;
const publicKey = new Uint8Array(Buffer.from(keys[1].key, 'hex'));

function compile(source, options) {
  const result = compileToIL(source, options);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

test('Upstream identity and public signing compose with project attributes, resources and canonical execution', () => {
  const source = 'public class Visible { public static int Value() { return 42; } } '
    + 'class Program { static void Main() { Console.WriteLine(Visible.Value()); } }';
  const options = {
    name: 'Merge', assemblyVersion: '1.2.3.4', assemblyCulture: 'fr-CA', publicKey, publicSign: true,
    assemblyAttributes: [{ type: versionAttribute, value: '1.2.3.4' }, { type: companyAttribute, value: 'Project18' }],
    resources: [resource], typeDefinitions: {
      Visible: { name: 'Visible', namespace: 'Fixture', access: 'internal' },
      Program: { name: 'Program', namespace: 'Fixture', access: 'internal' }
    }
  };
  const result = compile(source, options);
  const pe = readPE(result.assembly);
  assert.deepEqual(pe.metadata.rows[32][0].slice(1, 5), [1, 2, 3, 4]);
  assert.equal(pe.metadata.string(pe.metadata.rows[32][0][8]), 'fr-CA');
  assert.equal(pe.corFlags & 8, 8);
  assert.equal(pe.strongNameSignature.size, 128);
  assert.equal(pe.metadata.rows[12].length, 1);
  assert.equal(pe.metadata.rows[40].length, 1);
  assert.deepEqual(compile(source, options).assembly, result.assembly);
  assert.equal(loadAssembly(result.assembly).types.find(type => type.name === 'Fixture.Visible').name, 'Fixture.Visible');
  for (const Engine of [VirtualMachine, CilVirtualMachine]) {
    const runtime = new Engine(result.assembly);
    try {
      const execution = runtime.run();
      assert.equal(execution.state, 'terminated', execution.fault?.message);
      assert.equal(execution.output, '42\n');
    } finally {
      runtime.stop();
    }
  }
});

test('Canonical culture comes from actual Assembly metadata, including invariant and neutral values', () => {
  for (const assemblyCulture of ['', 'neutral', 'ja-JP']) {
    const result = compile('Console.WriteLine(42);', {
      assemblyCulture, assemblyAttributes: [{ type: companyAttribute, value: 'Project18' }], resources: [resource]
    });
    const pe = readPE(result.assembly);
    assert.equal(pe.metadata.string(pe.metadata.rows[32][0][8]), assemblyCulture === 'neutral' ? '' : assemblyCulture);
    assert.equal(loadAssembly(result.assembly).entryPoint, result.image.entryPoint);
  }
});

test('Project type definitions preserve upstream internal netmodule scaffolding and public exports', () => {
  const module = compile('public class Visible { public static int Value() { return 42; } }', {
    name: 'Part', outputKind: 'module', portablePdb: false,
    typeDefinitions: { Visible: { name: 'Visible', namespace: 'Fixture', access: 'public' } }
  });
  const modulePe = readPE(module.assembly);
  assert.equal(modulePe.metadata.counts[32] ?? 0, 0);
  const scaffolds = modulePe.metadata.rows[2].filter(row => modulePe.metadata.string(row[2]) === 'SharpForge');
  assert.equal(scaffolds.length, 2);
  assert(scaffolds.every(row => (row[0] & 7) === 0));
  const result = compile('Console.WriteLine(42);', {
    linkedModules: [module.assembly], resources: [resource],
    assemblyAttributes: [{ type: companyAttribute, value: 'Project18' }]
  });
  const linked = readAssemblyModules(readPE(result.assembly));
  assert.equal(linked.length, 1);
  assert.equal(linked[0].name, 'Part.netmodule');
  assert.deepEqual(linked[0].exportedTypes.map(type => [type.namespace, type.name]), [['Fixture', 'Visible']]);
  assert.throws(() => loadAssembly(result.assembly), /Multi-module assembly execution requires module resolution/);
});

test('Conflicting version sources and assembly attributes on netmodules produce explicit diagnostics', () => {
  const source = 'public class Visible {}';
  for (const options of [
    { outputKind: 'library', assemblyVersion: '1.0.0.0', assemblyAttributes: [{ type: versionAttribute, value: '2.0.0.0' }] },
    { outputKind: 'netmodule', assemblyAttributes: [{ type: companyAttribute, value: 'Project18' }] }
  ]) {
    const result = compileToIL(source, options);
    assert.equal(result.success, false);
    assert(result.diagnostics.some(item => item.code === 'SF3001' && /conflicts|Assembly manifest/.test(item.message)));
  }
});
