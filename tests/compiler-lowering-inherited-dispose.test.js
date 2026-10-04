import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

// Marker forces semantic generation; StringContent is a released registry type and makes no network request.
const source = `using System;
using System.Net.Http;
delegate void Marker();
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

for (const engine of ['source', 'cil']) {
  test(`SF-A09-T03 prerequisite ${engine}: semantic using resolves registered inherited Dispose`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
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
  const result = compile(`using System; delegate void Marker();
    class Program { static void Main() { using (var value = new Uri("https://example.test")) {} } }`);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'SF2200' && item.message.includes('without a Dispose method')),
    JSON.stringify(result.diagnostics));
});
