import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, loadAssembly, formatILDocument, assembleILDocument, nullableElementType} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {RegistryBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {nullableValue, invokeNullable} from '../packages/runtime/src/execution/nullable.js';
import {boxNullable, unboxNullable} from '../packages/runtime/src/execution/nullable-boxing.js';
import {managedPropertyType} from '../packages/runtime/src/ui/property-values.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {findContracts} from '@sharpforge/framework';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;\n';
const engines = {
  source: built => new VirtualMachine(built.image, {initialThreshold: 1024}),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly), {initialThreshold: 1024}),
  cil: built => new CilVirtualMachine(built.assembly, {initialThreshold: 1024}),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes, {initialThreshold: 1024})
};

function build(source) {
  const built = compileToIL(prefix + source, {includeDebug: true});
  assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
  return built;
}

test('A15 nullable registry names share one core symbol and expose underlying host property types', () => {
  const bridge = new RegistryBridge();
  for (const element of ['double', 'System.DateTimeOffset', 'System.TimeSpan']) {
    const short = bridge.typeFromName(element + '?');
    const canonical = bridge.typeFromName('System.Nullable`1<' + element + '>');
    assert.ok(short.equals(canonical));
    assert.equal(short.isNullableValueType, true);
    assert.equal(nullableElementType('System.Nullable`1<' + element + '>'), element);
    assert.equal(managedPropertyType('System.Nullable`1<' + element + '>'), element);
  }
  assert.equal(nullableElementType('System.Nullable`1<System.Guid>'), null);
  const selected = bridge.typeFromName('Microsoft.UI.Xaml.Controls.DatePicker').getMembers('SelectedDate')[0];
  assert.equal(selected.type.isNullableValueType, true);
});

const scalarSource = `
  int? absent = null; int? zero = 0;
  Console.WriteLine(absent.HasValue); Console.WriteLine(zero.HasValue); Console.WriteLine(zero.Value);
  Console.WriteLine(absent.GetValueOrDefault(17)); Console.WriteLine(zero.GetValueOrDefault(17));
  double? promoted = zero; Console.WriteLine(promoted.Value); Console.WriteLine(absent ?? 9);
  object boxed = zero; int? restored = (int?)boxed; Console.WriteLine(restored.Value);
  int? constructed = new int?(12); Console.WriteLine(constructed.Value);
  int? empty = new int?(); Console.WriteLine(empty == null);
  try { Console.WriteLine(absent.Value); } catch (InvalidOperationException error) { Console.WriteLine("absent"); }
  try { double? wrong = (double?)boxed; Console.WriteLine(wrong.Value); }
  catch (InvalidCastException error) { Console.WriteLine("exact box"); }
`;

const pickerSource = `
  DatePicker datePicker = new DatePicker(); TimePicker timePicker = new TimePicker();
  Console.WriteLine(datePicker.SelectedDate.HasValue); Console.WriteLine(timePicker.SelectedTime.HasValue);
  DateTimeOffset date = new DateTimeOffset(); datePicker.MinYear = date;
  datePicker.SelectedDate = date;
  DateTimeOffset? selectedDate = datePicker.SelectedDate;
  Console.WriteLine(selectedDate.HasValue); Console.WriteLine(selectedDate.Value.Year);
  timePicker.SelectedTime = TimeSpan.FromMilliseconds(0.0);
  TimeSpan? selectedTime = timePicker.SelectedTime;
  Console.WriteLine(selectedTime.HasValue); Console.WriteLine(selectedTime.Value.TotalMilliseconds);
  object boxedTime = selectedTime; TimeSpan? copied = (TimeSpan?)boxedTime;
  GC.Collect(); Console.WriteLine(copied.Value.TotalSeconds);
  datePicker.SelectedDate = null; timePicker.SelectedTime = null;
  Console.WriteLine(datePicker.SelectedDate == null); Console.WriteLine(timePicker.SelectedTime == null);
  Console.WriteLine(timePicker.SelectedTime.GetValueOrDefault().TotalMilliseconds);
  try { Console.WriteLine(datePicker.SelectedDate.Value.Year); }
  catch (InvalidOperationException error) { Console.WriteLine("date absent"); }
`;

for (const [engine, create] of Object.entries(engines)) {
  test(`A15 ${engine}: nullable presence, numeric promotion, construction and exact unboxing`, () => {
    const vm = create(build(scalarSource));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'False\nTrue\n0\n17\n0\n0\n9\n0\n12\nTrue\nabsent\nexact box\n');
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: DatePicker and TimePicker round-trip absence and present values`, () => {
    const vm = create(build(pickerSource));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'False\nFalse\nTrue\n1\nTrue\n0\n0\nTrue\nTrue\n0\ndate absent\n');
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  });
}

test('A15 emitted nullable property boundaries contain real Nullable<T> box and unbox.any instructions', () => {
  const inspector = new AssemblyInspector(build(pickerSource).assembly);
  const instructions = [...inspector.methods.keys()].flatMap(token => inspector.getMethod(token).instructions);
  const typesFor = name => instructions.filter(instruction => instruction.name === name)
    .map(instruction => inspector.metadata.typeName(instruction.operand));
  assert.ok(typesFor('box').some(type => nullableElementType(type) === 'System.TimeSpan'));
  assert.ok(typesFor('unbox.any').some(type => nullableElementType(type) === 'System.DateTimeOffset'));
});

test('A15 CLI nullable value records survive GC and snapshots without hidden managed references', () => {
  const vm = new CilVirtualMachine(build('Console.WriteLine("ready");').assembly, {initialThreshold: 64});
  try {
    vm.run();
    const reference = vm.platform.ui.allocate('System.DateTimeOffset', {UnixTimeMilliseconds: 0, Year: 1970, Month: 1, Day: 1});
    const weak = vm.heap.createHandle(reference, {weak: true});
    const value = nullableValue(vm, 'System.DateTimeOffset?', true, reference);
    assert.equal(value.value.UnixTimeMilliseconds, 0n, 'record copying preserves the declared Int64 field');
    assert.equal(copyExecution(value), value, 'the snapshot retains an immutable, scalar-only value');
    vm.heap.collect();
    assert.equal(vm.heap.getHandle(weak), null, 'the nullable struct does not hide an untraced managed reference');
    const boxed = boxNullable(vm, value, 'System.DateTimeOffset?');
    vm.heap.withRoots([boxed], () => {
      assert.equal(vm.heap.get(boxed).type, 'System.DateTimeOffset');
      const copy = unboxNullable(vm, boxed, 'System.DateTimeOffset?');
      const result = invokeNullable(vm, {owner: 'System.DateTimeOffset?', name: 'get_Value'}, copy, []);
      assert.equal(vm.platform.ui.native(result).Year, 1970);
      assert.throws(() => unboxNullable(vm, boxed, 'System.TimeSpan?'), {name: 'InvalidCastException'});
    });
    assert.equal(boxNullable(vm, nullableValue(vm, 'System.TimeSpan?', false), 'System.TimeSpan?'), null);
    assert.equal(unboxNullable(vm, null, 'System.TimeSpan?').hasValue, false);
    const fromMilliseconds = findContracts('System.TimeSpan', 'FromMilliseconds', true)[0];
    const duration = vm.platform.invoke(fromMilliseconds, [vm.platform.managed(1500, 'double')]);
    assert.equal(vm.platform.get(duration, 'TotalSeconds'), null, 'the released TimeSpan stores only milliseconds');
    const durationValue = nullableValue(vm, 'System.TimeSpan?', true, duration);
    assert.equal(durationValue.value.TotalMilliseconds, 1500);
    assert.equal(durationValue.value.TotalSeconds, 1.5, 'nullable copying invokes the declared computed getter');
    vm.heap.releaseHandle(weak);
    assert.equal(vm.heap.pins.length, 0);
  } finally { vm.stop(); }
});

test('A15 unsupported nullable arithmetic and other underlying types remain explicit diagnostics', () => {
  for (const source of ['int? value = 1; Console.WriteLine(value + 1);', 'decimal? value = null; Console.WriteLine(value.HasValue);']) {
    const result = compile(prefix + source);
    assert.equal(result.success, false);
    assert.ok(result.diagnostics.some(item => item.code === 'SF2200' && /nullable|decimal/i.test(item.message)));
  }
});
