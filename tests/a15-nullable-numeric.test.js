import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, assembleILDocument, formatILDocument, loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;\n';
const engines = {
  source: (built, options) => new VirtualMachine(built.image, options),
  canonical: (built, options) => new VirtualMachine(loadAssembly(built.assembly), options),
  cil: (built, options) => new CilVirtualMachine(built.assembly, options),
  reassembled: (built, options) => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes, options)
};

function build(source) {
  const built = compileToIL(prefix + source, {includeDebug: true});
  assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
  return built;
}

const values = `
  float? absent = null; float? zero = 0f;
  Console.WriteLine(absent.HasValue); Console.WriteLine(zero.HasValue); Console.WriteLine(zero.Value);
  float? rounded = (float)16777217d; double? wide = rounded; Console.WriteLine(wide.Value);
  uint? maximum = 4294967295u; double? widened = maximum; Console.WriteLine(widened.Value);
  object boxed = maximum; uint? restored = (uint?)boxed; Console.WriteLine(restored.Value);
  Console.WriteLine(absent.GetValueOrDefault(1.5f)); Console.WriteLine(absent.GetValueOrDefault());
  Console.WriteLine(maximum.Value > 0u); Console.WriteLine(absent == null); Console.WriteLine(null != zero);
  uint[] array = new uint[1]; Console.WriteLine(array[0]);
  float direct = default(float); uint integer = default(uint);
  Console.WriteLine(direct); Console.WriteLine(integer);
  float? created = new float?(2.5f); Console.WriteLine(created.Value); Console.WriteLine(created ?? 3f);
  try { double? wrong = (double?)boxed; Console.WriteLine(wrong.Value); }
  catch (InvalidCastException error) { Console.WriteLine("exact box"); }
`;

const casts = `
  int negative = -1; uint wrapped = unchecked((uint)negative); Console.WriteLine(wrapped);
  double negativeDouble = -1d; uint saturated = unchecked((uint)negativeDouble); Console.WriteLine(saturated);
  uint high = 4294967295u; int signed = unchecked((int)high); Console.WriteLine(signed);
  double large = 4294967296d;
  try { uint fail = checked((uint)negative); Console.WriteLine(fail); }
  catch (OverflowException error) { Console.WriteLine("signed overflow"); }
  try { int fail = checked((int)high); Console.WriteLine(fail); }
  catch (OverflowException error) { Console.WriteLine("unsigned overflow"); }
  try { uint fail = checked((uint)large); Console.WriteLine(fail); }
  catch (OverflowException error) { Console.WriteLine("floating overflow"); }
  float? absent = null; uint? propagated = (uint?)absent; Console.WriteLine(propagated.HasValue);
  float? fractional = 2.9f; int? truncated = (int?)fractional; Console.WriteLine(truncated.Value);
  uint? present = high;
  try { int? fail = checked((int?)present); Console.WriteLine(fail.Value); }
  catch (OverflowException error) { Console.WriteLine("nullable overflow"); }
`;

for (const [engine, create] of Object.entries(engines)) {
  test(`A15 ${engine}: UI nullable lowering preserves the general scalar arithmetic profile`, () => {
    const vm = create(build(`
      float value = 1.5f; value += 2.25f; Console.WriteLine(value);
      uint count = 1u; count++; count *= 2u; Console.WriteLine(count);
      long wide = 2147483648L; Console.WriteLine(wide);
      float? optional = new float?(value); Console.WriteLine(optional.Value);
    `));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '3.75\n4\n2147483648\n3.75\n');
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: Single and UInt32 nullable values retain presence, rounding and exact boxes`, () => {
    const vm = create(build(values));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output,
        'False\nTrue\n0\n16777216\n4294967295\n4294967295\n1.5\n0\nTrue\nTrue\nTrue\n0\n0\n0\n2.5\n2.5\nexact box\n');
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: numeric casts distinguish unsigned input, floating saturation and checked overflow`, () => {
    const vm = create(build(casts));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output,
        '4294967295\n0\n-1\nsigned overflow\nunsigned overflow\nfloating overflow\nFalse\n2\nnullable overflow\n');
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: three- and four-argument ChangeView accept nullable variables and preserve absent axes`, async () => {
    const built = build(`
      ScrollViewer viewer = new ScrollViewer {Width = 100, Height = 100,
        HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto};
      viewer.Content = new Border { Width = 1000, Height = 1000 };
      Window window = new Window { Content = viewer }; window.Activate();
      viewer.Measure(new Windows.Foundation.Size(100, 100));
      viewer.Arrange(new Windows.Foundation.Rect(0, 0, 100, 100));
      double? x = 20d; double? y = 30d; float? zoom = 2f;
      viewer.ChangeView(x, y, zoom, true);
      Console.WriteLine(viewer.HorizontalOffset); Console.WriteLine(viewer.VerticalOffset); Console.WriteLine(viewer.ZoomFactor);
      x = null; y = 0d; zoom = null; viewer.ChangeView(x, y, zoom);
      Console.WriteLine(viewer.HorizontalOffset); Console.WriteLine(viewer.VerticalOffset); Console.WriteLine(viewer.ZoomFactor);
    `);
    // The three-argument overload normally animates. Numeric presence is checked
    // with an explicit immediate policy; A16 owns scheduled/browser animation tests.
    const vm = create(built, {uiServices: {scrollFrames: {duration: 0}}});
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '20\n30\n2\n20\n0\n2\n');
    } finally { vm.stop(); }
  });
}

test('A15 numeric conversion metadata has an explicit source type and real unsigned widening', () => {
  const inspector = new AssemblyInspector(build(casts).assembly);
  const members = (inspector.metadata.rows[10] ?? []).map((_, index) => inspector.resolveToken(0x0a000001 + index));
  const helper = members.find(member => member.owner === 'SharpForge.UI.Runtime' && member.name === 'ConvertNumeric');
  assert.deepEqual(helper.signature.parameters, ['double', 'string', 'string', 'bool']);
  const instructions = [...inspector.methods.keys()].flatMap(token => inspector.getMethod(token).instructions);
  assert.ok(instructions.some(instruction => instruction.name === 'conv.r.un'));
  assert.ok(instructions.some(instruction => instruction.name === 'unbox.any' &&
    ['uint', 'System.UInt32'].includes(inspector.metadata.typeName(instruction.operand))));
});

test('A15 nullable operators and underlying types outside the declared profile stay explicit', () => {
  for (const source of [
    'float? x = 1f; Console.WriteLine(x + 2f);',
    'long? x = 1L; Console.WriteLine(x.HasValue);'
  ]) {
    const result = compile(prefix + source);
    assert.equal(result.success, false);
    assert.ok(result.diagnostics.some(item => item.code === 'SF2200' && /nullable/.test(item.message)));
  }
});
