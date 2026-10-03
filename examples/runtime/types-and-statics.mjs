import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';

const compilation=compileToIL(`using Microsoft.UI.Xaml;
class Widget {}
class Program {
  static Visibility DefaultVisibility;
  static void Main() {
    var first=new Widget(); var second=new Widget();
    Console.WriteLine(object.ReferenceEquals(first.GetType(),second.GetType()));
    Console.WriteLine(first.GetType().Name);
    Console.WriteLine(DefaultVisibility);
    Console.WriteLine(Visibility.Collapsed);
    string literal="a"; string allocated="ab".Substring(0,1);
    Console.WriteLine(object.ReferenceEquals(literal,allocated));
    Console.WriteLine(object.ReferenceEquals(literal,string.Intern(allocated)));
  }
}`);
assert(compilation.success,JSON.stringify(compilation.diagnostics));
const engines=[['source',new VirtualMachine(compilation.image)],['reloaded source',new VirtualMachine(loadAssembly(compilation.assembly))],['CIL',new CilVirtualMachine(compilation.assembly)]];
const expected='True\nWidget\nVisible\nCollapsed\nFalse\nTrue\n';
for(const [name,vm] of engines) {
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,expected);
  console.log(name+'\n'+result.output.trimEnd());vm.stop();
}
