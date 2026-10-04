import {isMethodPointer} from '../method-pointers.js';
import {finiteFloat} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';

const handlers=new Map();
for(const name of ['add','sub','mul','div','rem','and','or','xor','shl','shr',
  'add.ovf','add.ovf.un','sub.ovf','sub.ovf.un','mul.ovf','mul.ovf.un','div.un','rem.un','shr.un']) {
  handlers.set(name,vm=>{const right=vm.pop(),left=vm.pop();vm.push(vm.binary(name,left,right));});
}
for(const name of ['neg','not'])handlers.set(name,vm=>vm.push(vm.unary(name,vm.pop())));
for(const [name,op,unsigned] of [['ceq','eq',false],['cgt','gt',false],['cgt.un','gt',true],['clt','lt',false],['clt.un','lt',true]]) {
  handlers.set(name,vm=>{const right=vm.pop(),left=vm.pop();vm.push(vm.compare(left,right,op,unsigned)?1:0);});
}
for(const target of ['i1','u1','i2','u2','i4','u4','i8','u8','i','u','r4','r8']) {
  handlers.set('conv.'+target, vm => {
    const value = vm.pop();
    const preserve = (target === 'i' || target === 'u') && isMethodPointer(vm, value);
    vm.push(preserve ? value : vm.convert('conv.'+target, value));
  });
  if(target==='r4'||target==='r8')continue;
  for(const suffix of ['', '.un']) {
    const name='conv.ovf.'+target+suffix;
    handlers.set(name,vm=>vm.push(vm.convert(name,vm.pop())));
  }
}
handlers.set('conv.r.un',vm=>vm.push(vm.convert('conv.r.un',vm.pop())));
handlers.set('ckfinite',vm=>{
  vm.push(finiteFloat(vm.pop(), {fault: (name, message) => new ManagedFault(name, message)}));
});
export {handlers};
