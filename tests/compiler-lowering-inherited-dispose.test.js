import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {SourceText} from '@sharpforge/text';
import {emitAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {analyze} from '../packages/compiler/src/semantic-analysis.js';
import {generateFromSemanticAnalysis} from '../packages/compiler/src/codegen/semantic/generator.js';
import {disposeMethod} from '../packages/compiler/src/codegen/semantic/dispose-method.js';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {CoreTypes} from '../packages/compiler/src/symbols/core-types.js';
import {Accessibility} from '../packages/compiler/src/symbols/types.js';

// HttpContent's released metadata omits IDisposable, so automatic semantic generation remains incomplete.
// Exercise its actual bound trees through the generator seam; no registry state or product guard is changed.
const source = `using System;
using System.Net.Http;
class Program {
  static int ReturnEarly() {
    using (var content = new StringContent("return")) { return 7; }
  }
  static void Main() {
    var expression = new StringContent("expression");
    using (expression) { Console.WriteLine("expression"); }
    using (StringContent first = new StringContent("first"), second = new StringContent("second")) {
      Console.WriteLine("pair");
    }
    StringContent empty = null;
    using (empty) { Console.WriteLine("null"); }
    try { using (var throwing = new StringContent("throw")) { throw new Exception("boom"); } }
    catch (Exception error) { Console.WriteLine(error.Message); }
    Console.WriteLine(ReturnEarly());
    using var declaration = new StringContent("declaration");
    Console.WriteLine("declaration");
  }
}`;
let compiled;

function compileSemanticFixture() {
  const files = [parse(new SourceText(source, 'Program.cs'))];
  const analysis = analyze(files);
  assert.deepEqual(analysis.diagnostics.filter(item => item.severity === 'error'), []);
  assert.equal(analysis.incomplete, true, 'HttpContent IDisposable metadata remains a separate prerequisite');
  const generated = generateFromSemanticAnalysis(analysis, files);
  assert(generated.image, JSON.stringify(generated.unsupported));
  return {image: generated.image, assembly: emitAssembly(generated.image)};
}

for (const engine of ['source', 'cil']) {
  test(`SF-A09-T03 prerequisite ${engine}: direct semantic lowering resolves registered inherited Dispose`, () => {
    compiled ??= compileSemanticFixture();
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const disposed = [];
    vm.onWrite = event => {
      if (event.property !== '$disposed' || event.value !== true) return;
      const reference = {h: event.handle, g: event.generation};
      disposed.push(vm.platform.native(vm.platform.get(reference, '$text')));
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'expression\npair\nnull\nboom\n7\ndeclaration\n');
      assert.deepEqual(disposed, ['expression', 'second', 'first', 'throw', 'return', 'declaration']);
    } finally { vm.onWrite = null; vm.stop(); }
  });

  test(`SF-A09-T03 prerequisite ${engine}: existing declared source Dispose lowering is preserved`, () => {
    const program = compileToIL(`using System;
      delegate void Marker();
      class Resource : IDisposable {
        public void Dispose() { Console.WriteLine("disposed"); }
      }
      class Program {
        static void Main() {
          using (var resource = new Resource()) { Console.WriteLine("inside"); }
        }
      }`);
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'inside\ndisposed\n');
    } finally { vm.stop(); }
  });
}

test('SF-A09-T03 prerequisite: a Dispose-shaped source method alone does not make a resource disposable', () => {
  for (const method of ['public void Dispose() {}', 'private void Dispose() {}', 'public static void Dispose() {}',
    'public void Dispose(int value) {}', 'public void Dispose<T>() {}', 'public int Dispose() { return 0; }']) {
    const result = compile(`using System; delegate void Marker();
      class Resource { ${method} }
      class Program { static void Main() { using (var resource = new Resource()) {} } }`);
    assert.equal(result.success, false, method);
    assert(result.diagnostics.some(item => item.code === 'CS1674'), JSON.stringify(result.diagnostics));
  }
});

test('SF-A09-T03 prerequisite: registered resources without Dispose remain explicitly unsupported', () => {
  const result = compile(`using System;
    class Program { static void Main() { using (var value = new Uri("https://example.test")) {} } }`);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'CS1674'), JSON.stringify(result.diagnostics));
  assert(!result.diagnostics.some(item => item.code === 'SF1010'), 'the negative must not depend on a declaration profile error');
});

test('SF-A09-T03 prerequisite: public compilation retains the incomplete framework metadata boundary', () => {
  const outsideProfile = source.replace('class Program', 'delegate void Marker();\nclass Program');
  const result = compile(outsideProfile);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'SF1010'), JSON.stringify(result.diagnostics));
  assert.notEqual(result.semantic?.generated, true, 'the public compiler must not bypass incomplete metadata');
});

function registeredResource(overrides = {}) {
  const parent = 'Fixture.Parent';
  const child = 'Fixture.Child';
  const contract = {id: 1, owner: parent, name: 'Dispose', kind: 'method', isStatic: false,
    parameters: [], result: 'void', ...overrides};
  const registry = new RegistryBridge({
    types: new Map([[parent, {kind: 'bcl'}], [child, {kind: 'bcl', base: parent}]]),
    contracts: [contract], builtins: []
  });
  const core = new CoreTypes(registry);
  return {registry, core, type: registry.typeFromName(child), method: registry.typeFromName(parent).getMembers('Dispose')[0]};
}

test('SF-A09-T03 prerequisite: inherited fallback requires an executable public framework contract', () => {
  const valid = registeredResource();
  assert.equal(disposeMethod(valid.type, valid.core, valid.registry), valid.method);
  assert.equal(disposeMethod(valid.type, valid.core, {registryName: () => null}), null, 'unregistered source is excluded');
  for (const contract of [{isStatic: true}, {parameters: ['int']}, {result: 'int'}]) {
    const candidate = registeredResource(contract);
    assert.equal(disposeMethod(candidate.type, candidate.core, candidate.registry), null);
  }
  const mutations = [
    method => { method.declaredAccessibility = Accessibility.Private; },
    method => { method.declaredAccessibility = Accessibility.Protected; },
    method => { method.typeParameters = [{}]; },
    method => { method.contract = null; }
  ];
  for (const mutate of mutations) {
    const candidate = registeredResource();
    mutate(candidate.method);
    assert.equal(disposeMethod(candidate.type, candidate.core, candidate.registry), null);
  }
});
