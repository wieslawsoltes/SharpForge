import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System; using System.ComponentModel;
class Model : INotifyPropertyChanged {
  public event PropertyChangedEventHandler PropertyChanged;
  public void Raise() {
    if (PropertyChanged != null) PropertyChanged(this, new PropertyChangedEventArgs("Value"));
  }
}
class Program {
  static int Calls;
  static void Changed(object sender, PropertyChangedEventArgs args) {
    if (sender is Model && args.PropertyName == "Value") Calls++;
  }
  static void Main() {
    Model model = new Model(); INotifyPropertyChanged contract = model;
    contract.PropertyChanged += Changed; model.Raise();
    contract.PropertyChanged -= Changed; model.Raise();
    Console.WriteLine(Calls);
  }
}`;

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: field-like INPC events expose real interface add/remove accessors`, async () => {
    const built = compileToIL(source, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(value => value.message).join('\n'));
    const methods = built.image.methods.filter(method => method.owner === 'Model');
    assert.ok(methods.some(method => method.name === 'add_PropertyChanged'));
    assert.ok(methods.some(method => method.name === 'remove_PropertyChanged'));
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly, {virtualTime: true});
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '1\n');
  });
}
