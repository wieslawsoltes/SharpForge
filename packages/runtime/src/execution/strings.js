import {ManagedFault,isReference} from '../heap.js';

/** A managed-handle pool: weak entries never root their referents or retain host objects. */
export class StringInternPool {
  constructor(heap,entries=new Map(),{weak=false}={}) { this.heap=heap;this.entries=entries;this.weak=weak; }
  find(text) {
    const reference=this.entries.get(text);
    if(!reference)return null;
    try { if(this.heap.get(reference).kind==='string')return reference; }
    catch(error) { if(error.name!=='InvalidReferenceException')throw error; }
    this.entries.delete(text);return null;
  }
  literal(text) {
    const existing=this.find(text);if(existing)return existing;
    const reference=this.heap.string(text);this.entries.set(text,reference);return reference;
  }
  intern(reference) {
    const text=stringData(this.heap,reference),existing=this.find(text);
    if(existing)return existing;
    this.entries.set(text,reference);return reference;
  }
  isInterned(reference) { return this.find(stringData(this.heap,reference)); }
  *roots() { if(!this.weak)yield* this.entries.values(); }
  clear() { this.entries.clear(); }
}

function stringData(heap,reference) {
  if(reference===null)throw new ManagedFault('ArgumentNullException','String cannot be null');
  const record=heap.get(reference);
  if(record.kind!=='string')throw new ManagedFault('ArgumentException','A managed string is required');
  return record.data;
}
function pool(vm) { return new StringInternPool(vm.heap,vm.strings,{weak:!!vm.options?.weakStringInterning}); }
export function literalString(vm,text) { return pool(vm).literal(text); }
export function internString(vm,reference) { return pool(vm).intern(reference); }
export function isInternedString(vm,reference) { return pool(vm).isInterned(reference); }
export function* stringRoots(vm) { yield* pool(vm).roots(); }
export function clearStrings(vm) { vm.strings.clear();vm.constantValues?.clear(); }
export function referenceEquals(left,right) {
  return left===null&&right===null||isReference(left)&&isReference(right)&&left.h===right.h&&left.g===right.g;
}
/** C# char indexes UTF-16 code units, including individual halves of surrogate pairs. */
export function stringChar(vm,reference,index) {
  if(reference===null)throw new ManagedFault('NullReferenceException','String receiver required');
  const text=stringData(vm.heap,reference);
  if(!Number.isInteger(index)||index<0||index>=text.length)throw new ManagedFault('IndexOutOfRangeException','String index out of range');
  return text.charCodeAt(index);
}

/** String(char[]) copies UTF-16; null/empty arrays return the canonical empty string.
 * https://learn.microsoft.com/dotnet/api/system.string.-ctor?view=net-10.0
 */
export function stringFromChars(vm,arrayReference) {
  if(arrayReference===null)return literalString(vm,'');
  const record=vm.heap.get(arrayReference);
  if(record.kind!=='array'||!['char[]','System.Char[]'].includes(record.type))
    throw new ManagedFault('ArgumentException','Character array required');
  if(!record.data.length)return literalString(vm,'');
  let value='';
  for(let offset=0;offset<record.data.length;offset+=4096)value+=String.fromCharCode(...record.data.slice(offset,offset+4096).map(code=>Number(code)&0xffff));
  return vm.heap.string(value,[arrayReference]);
}
