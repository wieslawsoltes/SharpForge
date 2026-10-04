import {resolveCallType} from './generic-calls.js';
import {exceptionMatches} from './exception-types.js';
import {CilError,decodeCoded} from '@sharpforge/cil';
import {VirtualDispatch} from './vtable.js';
import {MethodTableRegistry} from './method-table.js';
import {castCacheFor} from './casting.js';
import {FieldResolutionCache} from './field-resolution-cache.js';
import {cachedTypeName} from './token-cache.js';

/** Assembly-derived metadata indexes. They are rebuilt on load, never snapshotted. */
export class CilTypeSystem {
  constructor(vm) {
    this.vm=vm;
    this.inspector=vm.inspector;
    this.types=new Map(vm.inspector.types.map(type=>[type.token,type]));
    this.names=new Map(vm.inspector.types.map(type=>[type.name,type.token]));
    this.layouts=new Map();
    this.fieldCache=new FieldResolutionCache(this);
    this.initializers=new Map();
    this.dispatch=new VirtualDispatch(vm.inspector);
    const metadata=vm.inspector.metadata;
    this.methodTables=new MethodTableRegistry({nativeIntBits:vm.options?.nativeIntBits,tokenResolver:token=>cachedTypeName(vm,token)});
    for(const type of this.types.values()) {
      this.initializers.set(type.token,type.methods.find(method=>method.name==='.cctor')??null);
      const base=type.baseToken?metadata.typeName(type.baseToken):null;
      const parameters=(metadata.rows?.[42]??[]).filter(row=>decodeCoded('TypeOrMethodDef',row[2])===type.token).sort((a,b)=>a[0]-b[0]);
      const fields=type.fields.filter(field=>!field.isStatic).map(field=>{
        const storageType=vm.inspector.signature(field.token).type.replace(/\s+mod(?:req|opt)\([^)]*\)/g,'').replace(/\s+pinned$/,'');
        return {...field,type:storageType.startsWith('method ')?'nint':storageType,storageType};
      });
      const underlying=base==='System.Enum'?fields.find(field=>field.name==='value__')?.type??'int':null;
      const dispatch=this.dispatch.table(type.token);
      this.methodTables.define({name:type.name,token:type.token,base,interfaces:type.interfaces.map(token=>metadata.typeName(token)),fields,
        flags:{interface:!!(type.flags&0x20),abstract:!!(type.flags&0x80),sealed:!!(type.flags&0x100),enum:base==='System.Enum',valueType:base==='System.ValueType'||base==='System.Enum'},
        enumUnderlyingType:underlying,genericArity:parameters.length,variance:parameters.map(row=>(row[1]&3)===1?1:(row[1]&3)===2?-1:0),
        vtable:[...[...dispatch.slots.keys()].map(slot=>[slot,this.dispatch.resolveSlot(dispatch,slot)]),...[...dispatch.declarations].map(([declaration,slot])=>[declaration,this.dispatch.resolveSlot(dispatch,slot)])]});
    }
    // Complete the metadata graph before execution so casts never scan name lists.
    for(const type of this.types.values())this.methodTables.get(type.token);
    vm.heap.methodTables=this.methodTables;
    for(const record of vm.heap.records)if(record)record.methodTable=this.methodTables.get(record.methodTable?.name??record.type);
    this.castCache=castCacheFor(this.methodTables);
  }
  table(type){return this.methodTables.get(resolveCallType(this.vm,type));}
  layout(typeToken,depth=0) {
    const methodTable=this.table(typeToken);
    if(this.layouts.has(methodTable))return this.layouts.get(methodTable);
    if(depth>64)throw new CilError('Inheritance depth exceeded');
    const type=this.types.get(methodTable.definitionToken);
    if(!type)throw new CilError('External type allocation is not implemented');
    if(type.flags&0x20)throw new CilError('Cannot instantiate an interface');
    const fields=methodTable.fields.map(field=>({...field,type:field.storageType??field.type.name}));
    const layout={name:methodTable.name,token:methodTable.token,methodTable,fields,index:new Map(fields.map((field,index)=>[field.token,index]))};
    this.layouts.set(methodTable,layout);
    return layout;
  }
  typeOf(ref) {if(ref===null)return null;const token=this.vm.heap.get(ref).methodTable.definitionToken;return this.types.has(token)?token:null;}
  matches(ref,typeName) {
    if(ref===null)return false;
    const record=this.vm.heap.get(ref),target=this.table(typeName);
    if(record.kind==='exception'&&exceptionMatches(record.methodTable.name,target.name))return true;
    return this.castCache.isAssignableFrom(target,record.methodTable);
  }
  field(token,ref) {
    if(ref===undefined)return this.fieldCache.resolve(token);
    const record=this.vm.heap.get(ref);
    return {...this.fieldCache.resolve(token,record.methodTable),record};
  }
  virtualTarget(ref,descriptor,target) {
    return this.dispatch.resolve(this.vm.heap.get(ref).methodTable.name,target,descriptor.ownerInstance);
  }
}
