import {compile} from '../../packages/compiler/src/index.js';
import {VirtualMachine} from '../../packages/runtime/src/vm.js';

const compiled=compile('int[] values=new int[10000];for(int i=0;i<values.Length;i++){values[i]=values.Length-i;}Array.Sort(values);Console.WriteLine(values[0]);Console.WriteLine(values[9999]);');
if(!compiled.success)throw new Error(JSON.stringify(compiled.diagnostics));
const vm=new VirtualMachine(compiled.image);let slices=0;
const result=await vm.runAsync({onSlice:()=>slices++});
if(result.fault)throw result.fault;
process.stdout.write(result.output+`Completed in ${slices} cooperative slices.\n`);
