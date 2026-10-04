import {validateRegistryInterfaces} from './registry-assignability.js';
import {normalizeRegistryFields} from './readonly-fields.js';
/** CLI primitive spellings are intrinsic; all managed reference types must be declared. */
export const intrinsicTypes=Object.freeze(['void','object','string','bool','char','byte','sbyte','short','ushort','int','uint','long','ulong','float','double','decimal','nint','nuint','System.Enum','System.ValueType','System.MulticastDelegate']);
export function validateRegistry({types,contracts,origins=new Map()}){
  const known=new Set(intrinsicTypes),signatures=new Set(),ids=new Set();
  const exists=type=>typeof type==='string'&&(known.has(type)||types.has(type)||type.endsWith('[]')&&exists(type.slice(0,-2)));
  for(const d of contracts){
    const fail=message=>{throw new Error(`[${origins.get(d.id)??'registry'}] ${message} at contract ${d.id} (${d.owner}::${d.name})`);};
    if(!Number.isSafeInteger(d.id)||d.id<0||ids.has(d.id))fail('Duplicate or invalid id');ids.add(d.id);
    if(!types.has(d.owner))fail('Undefined owner '+d.owner);
    const key=d.owner+'::'+d.name+'('+d.parameters.join(',')+')';if(signatures.has(key))fail('Duplicate member');signatures.add(key);
    for(const type of [...d.parameters,d.result])if(!exists(type))fail('Unknown type '+type);
    if(Object.hasOwn(d,'objectToStringOverride')&&
      (d.objectToStringOverride!==true||d.name!=='ToString'||d.isStatic||d.kind!=='method'||d.isAbstract||
       d.parameters.length!==0||d.result!=='string'))fail('Invalid Object.ToString override');
  }
  validateRegistryInterfaces(types);
  normalizeRegistryFields(types);
  return true;
}
