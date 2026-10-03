import {checkArrayStore} from './casting.js';
import {number,defaults,isNumber} from './numeric-ops.js';
import {isDecimal} from './decimal-ops.js';
import {scalarBinary,scalarUnary,scalarConvert} from './scalar-ops.js';
import {decodeNumericMode} from './numeric-types.js';
import {ManagedFault, isReference} from '../heap.js';
import {enumInfo,enumValue} from './enums.js';
export {sourceEnum,enumToString} from './enums.js';
export {runtimeTypeRoots,clearRuntimeTypes,runtimeTypeText} from './tokens.js';

export function defaultValue(type,vm={}) {
  if(enumInfo(vm,type))return enumValue(vm,type,0);
  return type==='double'?0:type==='bool'?false:defaults(type,vm.options);
}
const contexts=new WeakMap();
const managedFault=(type,message)=>new ManagedFault(type,message);
const context=vm=>{let selected=contexts.get(vm);if(!selected||selected.nativeIntBits!==(vm.options?.nativeIntBits??32)){selected={nativeIntBits:vm.options?.nativeIntBits??32,fault:managedFault};contexts.set(vm,selected);}return selected;};

/** Source numeric modes: 0 floating, 1 Int32, 2 string, 3 Boolean, 5 checked Int32. */
export function binary(vm, operator, a, b, mode = 0) {
  if (mode === 2 && operator === '+') return vm.heap.string(vm.format(a) + vm.format(b), [a, b]);
  if(mode>=16){const typed=decodeNumericMode(mode);return scalarBinary(operator,a,b,typed.type,typed.checked,context(vm));}
  const l = number(vm.value(a)), r = number(vm.value(b));
  if(mode===1||mode===5)return scalarBinary(operator,l,r,'int',mode===5,context(vm));
  if(mode===0&&typeof l==='number'&&typeof r==='number'&&['+','-','*','/','%','==','!=','<','<=','>','>='].includes(operator))return number(scalarBinary(operator,l,r,'double',false,context(vm)));
  const same = () => isReference(l) && isReference(r) ? l.h === r.h && l.g === r.g && (l.heapOwner===undefined||r.heapOwner===undefined||l.heapOwner===r.heapOwner) : l === r;
  switch (operator) {
    case '+': return l + r;
    case '-': return l - r;
    case '*': return l * r;
    case '/': return l / r;
    case '%': return l % r;
    case '==': return same();
    case '!=': return !same();
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
    case '&': return mode === 3 ? Boolean(l & r) : l & r;
    case '|': return mode === 3 ? Boolean(l | r) : l | r;
    case '^': return mode === 3 ? Boolean(l ^ r) : l ^ r;
    case '<<': return l << (r & 31);
    case '>>': return l >> (r & 31);
    default: throw new ManagedFault('InvalidProgramException', 'Unknown binary operation');
  }
}

export function convert(value, type, checked = 0,options={}) {
  options=options.options??options;
  if(value?.enumType)value=value.value;
  const scalarContext={...options,fault:(name,message)=>new ManagedFault(name,message)};
  if(checked>=16){const source=decodeNumericMode(checked);return scalarConvert(value,source.type,type,source.checked,scalarContext);}
  return number(scalarConvert(value,'double',type===0?'int':'double',checked===1,scalarContext));
}

export function unary(operator, value, mode = 0,options={}) {
  options=options.options??options;
  if(value?.enumType)value=value.value;
  const scalarContext={...options,fault:(name,message)=>new ManagedFault(name,message)};
  if(mode>=16){const typed=decodeNumericMode(mode);return scalarUnary(operator,value,typed.type,typed.checked,scalarContext);}
  if(mode===1||mode===5)return scalarUnary(operator,value,'int',mode===5,scalarContext);
  switch (operator) {
    case '!': return !value;
    case '~': return ~value;
    case '-': return -value;
    default: return +value;
  }
}

/** Source bytecode keeps scalar object values unboxed until CIL emission. */
export function checkSourceArrayStore(vm,record,value) {
  if(record.methodTable.elementType===vm.heap.methodTables.get('object')&&!isReference(value)&&
      (value?.enumType||isNumber(value)||isDecimal(value)||typeof value==='boolean'))return value;
  return checkArrayStore(vm.heap,record,value);
}
