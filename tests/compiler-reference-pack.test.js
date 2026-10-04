import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssemblyInspector } from '@sharpforge/cil';
import { compile, compileToAssembly, compileToReferenceAssembly, createReferenceSet } from '@sharpforge/compiler';
import { locateReferencePack, loadReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';

// SF-A02-T30: compiling against real .NET reference assemblies. The locator is tested against a made-up installation;
// the tests that bind against the real reference pack run only where a .NET SDK is installed (reference used here:
// Microsoft.NETCore.App.Ref 10.0.5 of SDK 10.0.201) and are skipped elsewhere.

function fakeInstallation(versions) {
  const root = mkdtempSync(join(tmpdir(), 'sharpforge-reference-pack-'));
  for (const version of versions) {
    const directory = join(root, 'packs', 'Microsoft.NETCore.App.Ref', version, 'ref', 'net' + version.split('.').slice(0, 2).join('.'));
    mkdirSync(directory, { recursive: true });
    for (const name of ['System.Runtime.dll', 'System.Console.dll', 'System.Runtime.xml']) writeFileSync(join(directory, name), '');
  }
  return root;
}

test('A02-T30 locateReferencePack picks the newest release, a requested framework, and only assemblies', t => {
  const root = fakeInstallation(['8.0.11', '10.0.5', '10.0.4', '11.0.0-preview.4.26230.115']);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const newest = locateReferencePack({ dotnetRoot: root });
  assert.equal(newest.version, '10.0.5');
  assert.equal(newest.targetFramework, 'net10.0');
  assert.deepEqual(
    newest.files.map(path => path.slice(newest.directory.length + 1)),
    ['System.Console.dll', 'System.Runtime.dll'],
  );
  assert.equal(locateReferencePack({ dotnetRoot: root, targetFramework: 'net8.0' }).version, '8.0.11');
  assert.equal(locateReferencePack({ dotnetRoot: root, targetFramework: 'net11.0' }).version, '11.0.0-preview.4.26230.115');
  assert.equal(locateReferencePack({ dotnetRoot: root, targetFramework: 'net9.0' }), null);
});

test('A02-T30 locateReferencePack falls back to a preview and reports a missing installation as null', t => {
  const root = fakeInstallation(['11.0.0-preview.4.26230.115', '11.0.0-preview.5.26302.115']);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(locateReferencePack({ dotnetRoot: root }).version, '11.0.0-preview.5.26302.115');
  assert.equal(locateReferencePack({ dotnetRoot: join(root, 'missing') }), null);
  assert.equal(loadReferencePack({ dotnetRoot: join(root, 'missing') }), null);
});

test('A02-T30 a reference set keeps an undecodable image as an entry every compilation reports as CS0009', () => {
  const library = compileToReferenceAssembly('public class Widget { public int Size => 3; }', { name: 'Widgets' });
  assert.ok(library.assembly, 'the library compiles');
  const set = createReferenceSet([
    { bytes: library.assembly, display: 'Widgets.dll' },
    { bytes: new Uint8Array([1, 2, 3]), display: 'broken.dll' },
  ]);
  assert.ok(Object.isFrozen(set));
  assert.equal(set[0].assembly.name, 'Widgets');
  assert.equal(set[1].assembly, undefined);
  for (let round = 0; round < 2; round++) {
    const result = compile('class P { static void Main() { } }', { references: set });
    assert.deepEqual(
      result.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code),
      ['CS0009'],
    );
  }
  assert.throws(() => createReferenceSet(new Array(5000).fill({ bytes: new Uint8Array(0) })), RangeError);
});

const pack = loadReferencePack();
const skip = pack ? false : 'no .NET reference pack is installed';

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample', references: pack.references }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    members = new Set();
  for (const method of inspector.methods.values()) {
    for (const instruction of inspector.getMethod(method.token).instructions) {
      if (instruction.operandKind !== 'token' || instruction.operand >>> 24 !== 0x0a) continue;
      const target = inspector.resolveToken(instruction.operand);
      members.add(`${target.owner}::${target.name}`);
    }
  }
  return { members: [...members] };
}

test('A02-T30 the installed reference pack is found and read as one reusable set', { skip }, () => {
  assert.match(pack.pack.version, /^\d+\.\d+\.\d+/);
  assert.ok(pack.references.length > 100, `${pack.references.length} assemblies`);
  assert.ok(pack.references.every(entry => entry.assembly), 'every assembly of the pack decodes');
  assert.equal(readReferenceFiles(pack.pack.files.slice(0, 2)).length, 2);
});

test('A02-T30 with references the emitted member references name what real .NET declares', { skip }, () => {
  const { members } = emit(`using System;
    using System.Collections.Generic;
    class P {
      static void Main() {
        var ages = new Dictionary<string, int> { ["ann"] = 31 };
        if (ages.TryGetValue("ann", out var age) && int.TryParse("11", out var parsed)) Console.WriteLine(age + parsed);
        var list = new List<int> { 3, 1, 2 };
        foreach (var item in list) Console.WriteLine(item);
        Console.WriteLine(string.Join(",", list));
      }
    }`);
  for (const expected of [
    'System.Collections.Generic.Dictionary`2<string, int>::TryGetValue',
    'System.Int32::TryParse',
    'System.Collections.Generic.List`1<int>::GetEnumerator',
    'System.Collections.Generic.List`1+Enumerator<int>::MoveNext',
  ]) {
    assert.ok(members.includes(expected), `${expected} is referenced; found ${members.join(', ')}`);
  }
  assert.ok(!members.some(member => member.includes('SharpForge.Runtime')), 'no registry-only type is named');
});

test('A02-T30 the same reference set serves many compilations with the same result', { skip }, () => {
  const source = 'class P { static void Main() { System.Console.WriteLine(System.Math.Max(1, 2)); } }',
    first = compileToAssembly(source, { name: 'Sample', references: pack.references }),
    second = compileToAssembly(source, { name: 'Sample', references: pack.references });
  assert.ok(first.assembly && second.assembly);
  assert.deepEqual([...first.assembly], [...second.assembly]);
  const unknown = compile('class P { static void Main() { System.Console.Missing(); } }', { references: pack.references });
  assert.deepEqual(
    unknown.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code),
    ['CS0117'],
  );
});
