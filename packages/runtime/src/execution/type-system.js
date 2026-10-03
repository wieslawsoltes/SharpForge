import {exceptionMatches} from './exception-types.js';
import {CilError,systemType,CilDispatchTable} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';

/** Assembly-derived metadata indexes. They are rebuilt on load, never snapshotted. */
export class CilTypeSystem {
  constructor(vm) {
    this.vm=vm;
    this.inspector=vm.inspector;
    this.types=new Map(vm.inspector.types.map(type=>[type.token,type]));
    this.names=new Map(vm.inspector.types.map(type=>[type.name,type.token]));
    this.layouts=new Map();
    this.assignable=new Map();
    this.initializers=new Map();
    this.dispatch=new CilDispatchTable(vm.inspector);
    for(const type of this.types.values()) {
      this.initializers.set(type.token,type.methods.find(method=>method.name==='.cctor')??null);
      const targets=new Set([systemType(type.name)]);
      let current=type,depth=0;
      while(current&&depth++<64) {
        for(const token of current.interfaces)targets.add(systemType(vm.inspector.metadata.typeName(token)));
        if(!current.baseToken)break;
        targets.add(systemType(vm.inspector.metadata.typeName(current.baseToken)));
        current=this.types.get(current.baseToken);
      }
      this.assignable.set(type.name,targets);
    }
  }
  layout(typeToken,depth=0) {
    if(this.layouts.has(typeToken))return this.layouts.get(typeToken);
    if(depth>64)throw new CilError('Inheritance depth exceeded');
    const type=this.types.get(typeToken);
    if(!type)throw new CilError('External type allocation is not implemented');
    if(type.flags&0x20)throw new CilError('Cannot instantiate an interface');
    const base=type.baseToken>>>24===2?this.layout(type.baseToken,depth+1):{fields:[]};
    const fields=[...base.fields,...type.fields.filter(field=>!field.isStatic).map(field=>({...field,type:this.vm.inspector.signature(field.token).type}))];
    const layout={name:type.name,token:typeToken,fields,index:new Map(fields.map((field,index)=>[field.token,index]))};
    this.layouts.set(typeToken,layout);
    return layout;
  }
  typeOf(ref) {return ref===null?null:this.names.get(this.vm.heap.get(ref).type)??null;}
  matches(ref,typeName) {
    if(ref===null)return false;
    const record=this.vm.heap.get(ref),target=systemType(typeName);
    if(target==='System.Object')return true;
    if(record.kind==='exception')return exceptionMatches(record.type,target);
    return systemType(record.type)===target||!!this.assignable.get(record.type)?.has(target);
  }
  field(token,ref) {
    const field=this.vm.inspector.resolveToken(token),resolved=field.resolvedToken??token;
    if(field.kind!=='field')throw new CilError('Invalid field token');
    if(ref===undefined)return {field,token:resolved};
    const record=this.vm.heap.get(ref),layout=this.layout(this.typeOf(ref)),index=layout.index.get(resolved);
    if(index===undefined)throw new ManagedFault('InvalidProgramException','Field is not part of this object');
    return {field,token:resolved,record,index};
  }
  virtualTarget(ref,descriptor,target) {
    return this.dispatch.resolve(this.typeOf(ref),target);
  }
}
