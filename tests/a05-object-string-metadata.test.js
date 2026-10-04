import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL, compile} from '@sharpforge/compiler';
import {AssemblyInspector, loadAssembly} from '@sharpforge/cil';

for (const pipeline of ['bound', 'legacy']) {
  test(`managed Object.ToString ${pipeline}: slot flags survive real CLI and canonical source loading`, () => {
    const compiled = compileToIL('using System; class Value { public override string ToString() { return "managed"; } }' +
      'class Program { static void Main() { object value = new Value(); Console.WriteLine(value.ToString()); } }', {pipeline});
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const imageMethod = compiled.image.methods.find(method => method.owner === 'Value' && method.name === 'ToString');
    assert.equal(imageMethod.isVirtual, true);
    assert.notEqual(imageMethod.isNewSlot, true);
    const inspector = new AssemblyInspector(compiled.assembly);
    const method = inspector.types.find(type => type.name === 'Value').methods.find(method => method.name === 'ToString');
    assert.equal(method.flags & 0x140, 0x40);
    const loaded = loadAssembly(compiled.assembly).methods.find(method => method.owner === 'Value' && method.name === 'ToString');
    assert.equal(loaded.isVirtual, true);
    assert.notEqual(loaded.isNewSlot, true);
  });
}

test('Object.ToString override admission preserves invalid signature/access and source inheritance diagnostics', () => {
  for (const declaration of ['private override string ToString() { return "x"; }',
    'public override int ToString() { return 1; }', 'public override string ToString(int value) { return "x"; }']) {
    const result = compile('class Value { ' + declaration + ' } class Program { static void Main() {} }');
    assert.equal(result.success, false);
  }
  const inherited = compile('class Root {} class Leaf : Root {} class Program { static void Main() { object value = new Leaf(); } }');
  assert.equal(inherited.success, false);
  assert(inherited.diagnostics.some(diagnostic => /inheritance/i.test(diagnostic.message)));
});
