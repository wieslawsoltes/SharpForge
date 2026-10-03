import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine,VirtualMachine} from '@sharpforge/runtime';
const code=compileToIL('using System.Threading.Tasks; class P { static async Task Main(){Console.WriteLine("before");await Task.Delay(10);Console.WriteLine("after");} }');
if(!code.success)throw new Error(JSON.stringify(code.diagnostics));
for(const vm of [new VirtualMachine(code.image,{virtualTime:true}),new CilVirtualMachine(code.assembly,{virtualTime:true})]) {
  vm.run();const snapshot=vm.snapshot();await vm.runAsync();const output=vm.output.join('');
  vm.restore(snapshot);if(vm.state==='paused')vm.state='running';await vm.runAsync();
  if(vm.output.join('')!==output)throw new Error('Snapshot replay diverged');
  console.log(vm.constructor.name+'\n'+output.trimEnd());vm.stop();
}
