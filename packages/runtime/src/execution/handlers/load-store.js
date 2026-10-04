import {loadSlot} from '../slot-storage.js';
import {storeScalarSlot} from '../scalar-slot-store.js';
import {float} from '../numeric-ops.js';
import {cachedUserString} from '../token-cache.js';

const handlers=new Map([
  ['nop',()=>{}],['break',()=>{}],
  ['ldnull',vm=>vm.push(null)],
  ['ldstr',(vm,frame,instruction)=>vm.push(vm.string(cachedUserString(vm,instruction.operand)))],
  ['dup',vm=>{const value=vm.pop();vm.push(value);vm.push(value);}],
  ['pop',vm=>{vm.pop();}]
]);
for(const name of ['ldc.i4','ldc.i4.s','ldc.i8'])handlers.set(name,(vm,frame,instruction)=>vm.push(instruction.operand));
for(const kind of ['r4','r8'])handlers.set('ldc.'+kind,(vm,frame,instruction)=>vm.push(float(instruction.operand,kind)));
handlers.set('ldc.i4.m1',vm=>vm.push(-1));
for(let value=0;value<=8;value++)handlers.set('ldc.i4.'+value,vm=>vm.push(value));
for(const arg of [false,true]) {
  const slot=arg?'arg':'loc',kind=arg?'arg':'local';
  for(const operation of ['ld','st','lda']) {
    const stem=(operation==='lda'?'ld'+slot+'a':operation+slot);
    for(const suffix of ['', '.s', '.0', '.1', '.2', '.3']) {
      // Compact load/store forms are registered only where ECMA-335 defines them.
      if(suffix!==''&&suffix!=='.s'&&(operation==='lda'||arg&&operation==='st'))continue;
      handlers.set(stem+suffix,(vm,frame,instruction)=>{
        const index=instruction.operand??Number(suffix.slice(1));
        if (operation === 'st') {
          if (!storeScalarSlot(vm, frame, arg, index)) vm.dereference(vm.address(kind, index), true, vm.pop());
        }
        else if(operation==='lda')vm.push(vm.address(kind,index));
        else vm.push(loadSlot(vm,frame,arg,index));
      });
    }
  }
}
export {handlers};
