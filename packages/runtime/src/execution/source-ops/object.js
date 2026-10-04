import {readSourceField,writeSourceField,newSourceValue} from '../source-value-storage.js';
import {boxValue,unboxValue} from '../boxing.js';
import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {defaultValue,checkSourceArrayStore} from '../source-ops.js';
import {sourceIndex} from '../source-numbers.js';
import {createArray} from '../arrays.js';
import {storageRead, storageWrite} from '../array-storage.js';
import {enumValue} from '../enums.js';

function fieldDefault(field) {
  return defaultValue(field.type,this);
}

/** Preserve source object/array carriers and write-notification order. */
export const sourceObjectHandlers = Object.freeze({
  [Op.LDFLD](vm,frame,a) {
    vm.stack.push(readSourceField(vm,vm.stack.pop(),a));
  },
  [Op.STFLD](vm,frame,a) {
    const value=vm.stack.pop(),receiver=vm.stack.pop();
    vm.stack.push(writeSourceField(vm,receiver,a,value));
  },
  [Op.BOX](vm,frame,a) {
    vm.stack.push(boxValue(vm,vm.stack.pop(),vm.image.constants[a]));
  },
  [Op.UNBOXANY](vm,frame,a) {
    vm.stack.push(unboxValue(vm,vm.stack.pop(),vm.image.constants[a]));
  },
  [Op.NEWOBJ](vm,frame,a) {
    const type=vm.image.types[a];
    vm.stack.push(type.valueType?newSourceValue(vm,type):vm.heap.object(type.name,type.fields.map(fieldDefault,vm)));
  },
  [Op.NEWARR](vm,frame,a) {
    vm.stack.push(createArray(vm,vm.image.constants[a],[vm.stack.pop()]));
  },
  [Op.LDELEM](vm) {
    const index=sourceIndex(vm.stack.pop()),ref=vm.stack.pop();
    const record=vm.indexed(ref,index),element=record.methodTable.elementType;
    const value=storageRead(record.data,index,element,{source:true});
    vm.stack.push(element.flags.enum?enumValue(vm,element.name,value):value);
  },
  [Op.STELEM](vm) {
    const value=vm.stack.pop(),index=sourceIndex(vm.stack.pop()),ref=vm.stack.pop();
    const record=vm.indexed(ref,index),oldValue=storageRead(record.data,index,record.methodTable.elementType,{source:true});
    checkSourceArrayStore(vm,record,value);
    storageWrite(record.data,index,value);
    vm.stack.push(value);
    vm.notifyWrite({kind:'array',handle:ref.h,generation:ref.g,index,value,oldValue});
  },
  [Op.LENGTH](vm) {
    const record=vm.heap.get(vm.stack.pop());
    if(record.kind!=='array'&&record.kind!=='string')throw new ManagedFault('InvalidProgramException','Length requires an array or string');
    vm.stack.push(record.data.length);
  }
});
