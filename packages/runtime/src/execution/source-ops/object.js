import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {defaultValue,checkSourceArrayStore} from '../source-ops.js';
import {sourceIndex} from '../source-numbers.js';

function fieldDefault(field) {
  return defaultValue(field.type,this);
}

/** Preserve source object/array carriers and write-notification order. */
export const sourceObjectHandlers = Object.freeze({
  [Op.LDFLD](vm,frame,a) {
    const ref=vm.stack.pop(),record=vm.heap.get(ref);
    if(a>=record.data.length||record.kind!=='object')throw new ManagedFault('InvalidProgramException','Invalid field index');
    vm.stack.push(record.data[a]);
  },
  [Op.STFLD](vm,frame,a) {
    const value=vm.stack.pop(),ref=vm.stack.pop(),record=vm.heap.get(ref);
    if(a>=record.data.length||record.kind!=='object')throw new ManagedFault('InvalidProgramException','Invalid field index');
    const oldValue=record.data[a];
    record.data[a]=value;
    vm.stack.push(value);
    vm.notifyWrite({kind:'field',handle:ref.h,generation:ref.g,index:a,value,oldValue});
  },
  [Op.NEWOBJ](vm,frame,a) {
    const type=vm.image.types[a];
    vm.stack.push(vm.heap.object(type.name,type.fields.map(fieldDefault,vm)));
  },
  [Op.NEWARR](vm,frame,a) {
    const length=sourceIndex(vm.stack.pop()),type=vm.image.constants[a],ref=vm.heap.array(type,length);
    vm.heap.get(ref).data.fill(defaultValue(type,vm));
    vm.stack.push(ref);
  },
  [Op.LDELEM](vm) {
    const index=sourceIndex(vm.stack.pop()),ref=vm.stack.pop();
    vm.stack.push(vm.indexed(ref,index).data[index]);
  },
  [Op.STELEM](vm) {
    const value=vm.stack.pop(),index=sourceIndex(vm.stack.pop()),ref=vm.stack.pop();
    const record=vm.indexed(ref,index),oldValue=record.data[index];
    checkSourceArrayStore(vm,record,value);
    record.data[index]=value;
    vm.stack.push(value);
    vm.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index,value,oldValue});
  },
  [Op.LENGTH](vm) {
    const record=vm.heap.get(vm.stack.pop());
    if(record.kind!=='array'&&record.kind!=='string')throw new ManagedFault('InvalidProgramException','Length requires an array or string');
    vm.stack.push(record.data.length);
  }
});
