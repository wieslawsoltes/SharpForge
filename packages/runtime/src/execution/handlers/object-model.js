import {executeFieldAccess} from '../value-fields.js';
import {boxValue, unboxValue} from '../boxing.js';
import {loadFieldValue} from '../field-storage.js';
import {castReference} from '../casting.js';
import {staticSlot,finishMemoryAccess} from '../statics.js';

const handlers=new Map();
handlers.set('volatile.',(vm,frame)=>{frame.volatileAccess=true;});
for(const name of ['ldsfld','stsfld','ldsflda'])handlers.set(name,(vm,frame,instruction)=>{
  const slot=staticSlot(vm,instruction.operand,frame,name);
  if(!slot||vm.state==='terminated')return;
  if(vm.ensureInitialized(slot.typeToken,'field',slot.genericIdentity)){frame.pc--;return;}
  if(name==='ldsfld')vm.push(loadFieldValue(vm,slot.field,vm.statics.get(slot.key)));
  else if(name==='stsfld')vm.dereference(vm.address('static',slot.key),true,vm.storage(vm.pop(),slot.field.signature.type));
  else vm.push(vm.address('static',slot.key));
  finishMemoryAccess(frame);
});
for (const name of ['ldfld', 'stfld', 'ldflda']) {
  handlers.set(name, (vm, frame, instruction) => executeFieldAccess(vm, frame, instruction, name));
}
handlers.set('box', (vm, frame, instruction) => vm.push(boxValue(vm, vm.pop(), instruction.operand)));
for (const name of ['unbox', 'unbox.any']) {
  handlers.set(name, (vm, frame, instruction) => vm.push(unboxValue(vm, vm.pop(), instruction.operand, name === 'unbox')));
}
for(const name of ['castclass','isinst'])handlers.set(name,(vm,frame,instruction)=>{
  vm.push(castReference(vm.heap,vm.pop(),vm.typeSystem.table(instruction.operand),name==='castclass'));
});
export {handlers};
