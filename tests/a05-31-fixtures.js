import {compile} from '@sharpforge/compiler';
import {Builtins,Op} from '@sharpforge/bytecode';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

/** Input allocation/population is outside timed slices: the workload is Array.Sort. */
export function sortingVM(engine,length,{operation='Sort',observer=false,...options}={}) {
  let vm;
  if(engine==='source') {
    const compiled=compile(`class P { static void Observe() { Console.WriteLine("observer"); } static void Main() { int[] values = new int[0]; Array.${operation}(values); } }`);
    if(!compiled.success)throw new Error(JSON.stringify(compiled.diagnostics));
    vm=new VirtualMachine(compiled.image,options);
    for(let i=0;i<100;i++) {
      const code=vm.image.methods[vm.top.methodId].code,at=vm.top.pc*3;
      if(code[at]===Op.BUILTIN&&Builtins[code[at+1]].name==='Array.'+operation)break;
      vm.runSlice({instructionBudget:1,timeBudgetMs:100});
    }
    const code=vm.image.methods[vm.top.methodId].code,at=vm.top.pc*3;
    if(code[at]!==Op.BUILTIN)throw new Error('Array intrinsic was not reached');
  } else {
    const methods=[{name:'Main',parameters:['int[]'],body:(w,c)=>w.op('ldarg.0').op('call',c.member('System.Array',operation,'void',['System.Array'])).op('ret')}];
    if(observer)methods.push({name:'Observe',body:(w,c)=>w.op('ldstr',0x70000000+c.md.userString('observer')).op('call',c.member('System.Console','WriteLine','void',['string'])).op('ret')});
    vm=new CilVirtualMachine(managedFixture({name:'PreemptibleArrays',methods}),{arguments:[[]],...options});
    vm.runSlice({instructionBudget:1,timeBudgetMs:100}); // ldarg.0
  }
  const reference=vm.heap.array('int',length),data=vm.heap.get(reference).data;
  for(let i=0;i<length;i++)data[i]=length-i;
  if(engine==='source'){vm.stack[vm.stack.length-1]=reference;vm.top.locals.fill(null);}
  else {vm.top.stack[vm.top.stack.length-1]=reference;vm.top.args[0]=null;}
  if(observer) {
    const method=engine==='source'?vm.image.methods.find(method=>method.name==='Observe').id:[...vm.inspector.methods.values()].find(method=>method.name==='Observe').token;
    const delegate=vm.platform.delegate('System.Action',method,null);vm.scheduler.enqueue(delegate,[]);
  }
  return {vm,reference,data};
}

export function loopVM(engine,options={}) {
  if(engine==='source') {
    const result=compile('int n=0; while(true){n=n+1;}');
    if(!result.success)throw new Error(JSON.stringify(result.diagnostics));
    return new VirtualMachine(result.image,options);
  }
  return new CilVirtualMachine(managedFixture({methods:[{name:'Main',body:w=>w.mark('loop').op('nop').op('br','loop')}]}),options);
}
