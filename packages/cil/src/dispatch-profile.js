import {CilError} from './binary.js';
import {decodeCoded,token} from './metadata.js';

const virtual=0x40,newslot=0x100,final=0x20;
const signatureKey=signature=>JSON.stringify([signature.returnType,signature.parameters,signature.genericArity??0,signature.callingConvention??0,!!signature.isStatic]);
/** ECMA-335 II.10.3 and II.22.27: virtual slots belong to declarations, not names.
 * Closed assembly profile: external and generic virtual slots remain unsupported.
 */
export class CilDispatchTable {
  constructor(inspector) {
    this.inspector=inspector;this.types=new Map(inspector.types.map(type=>[type.token,type]));
    this.tables=new Map();this.building=new Set();this.implementations=new Map();this.targetCache=new Map();
    for(const row of inspector.metadata.rows?.[25]??[]) {
      const owner=token(2,row[0]);
      if(!this.implementations.has(owner))this.implementations.set(owner,[]);
      this.implementations.get(owner).push({body:decodeCoded('MethodDefOrRef',row[1]),declaration:decodeCoded('MethodDefOrRef',row[2])});
    }
  }
  definition(methodToken) {
    const descriptor=this.inspector.resolveToken(methodToken),resolved=descriptor.resolvedToken??(descriptor.token>>>24===6?descriptor.token:null);
    if(!resolved)throw new CilError('External virtual declarations are not executable');
    const method=this.inspector.methods.get(resolved);
    if(!method)throw new CilError('Virtual declaration is not a MethodDef');
    return method;
  }
  table(typeToken) {
    if(this.tables.has(typeToken))return this.tables.get(typeToken);
    const type=this.types.get(typeToken);
    if(!type)return {slots:new Map(),aliases:new Map(),declarations:new Map(),visible:new Map(),ancestors:new Set()};
    if(this.building.has(typeToken)||this.building.size>64)throw new CilError('Invalid virtual type hierarchy');
    this.building.add(typeToken);
    try {
      const base=this.table(type.baseToken),slots=new Map(base.slots),aliases=new Map(base.aliases),declarations=new Map(base.declarations),visible=new Map(base.visible),ancestors=new Set(base.ancestors);
      ancestors.add(typeToken);
      const interfaces=[];
      for(const interfaceToken of type.interfaces) {
        const inherited=this.table(interfaceToken);interfaces.push(inherited);
        for(const ancestor of inherited.ancestors)ancestors.add(ancestor);
        if(type.flags&0x20) {
          for(const [slot,body] of inherited.slots)slots.set(slot,body);
          for(const [slot,body] of inherited.aliases)aliases.set(slot,body);
          for(const [declaration,slot] of inherited.declarations)declarations.set(declaration,slot);
          for(const [key,slot] of inherited.visible)visible.set(key,slot);
        }
      }
      for(const method of type.methods) {
        if(!(method.flags&virtual)||method.flags&0x10)continue;
        const key=method.name+'::'+signatureKey(this.inspector.signature(method.token));
        const inherited=method.flags&newslot?undefined:visible.get(key),slot=inherited??method.token;
        if(inherited!==undefined) {
          const previous=this.resolveSlot({slots,aliases},slot);
          if(this.inspector.methods.get(previous)?.flags&final)throw new CilError('A final virtual method cannot be overridden');
        }
        aliases.delete(slot);slots.set(slot,method.token);declarations.set(method.token,slot);visible.set(key,slot);
      }
      // Map ordinary implicit interface implementations before explicit MethodImpl rows.
      for(const iface of interfaces)for(const [declaration,slot] of iface.declarations) {
        const method=this.inspector.methods.get(declaration),key=method.name+'::'+signatureKey(this.inspector.signature(declaration));
        const implementation=visible.get(key);
        if(implementation!==undefined){slots.set(slot,slots.get(implementation));if(slot!==implementation)aliases.set(slot,implementation);}
      }
      const explicit=new Set();
      for(const implementation of this.implementations.get(typeToken)??[]) {
        const declaration=this.definition(implementation.declaration),body=this.definition(implementation.body);
        if(!(declaration.flags&virtual)||declaration.flags&0x10||body.flags&0x10||!ancestors.has(declaration.ownerToken)||!ancestors.has(body.ownerToken))throw new CilError('Invalid MethodImpl owner or virtual declaration');
        if(signatureKey(this.inspector.signature(declaration.token))!==signatureKey(this.inspector.signature(body.token)))throw new CilError('MethodImpl signatures do not match');
        const declarationTable=declaration.ownerToken===typeToken?{declarations}:this.table(declaration.ownerToken),slot=declarationTable.declarations.get(declaration.token);
        if(slot===undefined||explicit.has(slot))throw new CilError('Invalid or duplicate MethodImpl declaration');
        const previous=this.resolveSlot(base,slot);
        if(!(this.types.get(declaration.ownerToken)?.flags&0x20)&&previous!==undefined&&this.inspector.methods.get(previous)?.flags&final)throw new CilError('A final virtual method cannot be overridden');
        const bodySlot=declarations.get(body.token);
        explicit.add(slot);slots.set(slot,body.token);
        if(bodySlot!==undefined&&bodySlot!==slot)aliases.set(slot,bodySlot);else aliases.delete(slot);
      }
      const table={slots,aliases,declarations,visible,ancestors};this.tables.set(typeToken,table);return table;
    } finally {this.building.delete(typeToken);}
  }
  resolveSlot(table,slot) {
    const seen=new Set();
    while(table.aliases.has(slot)) {
      if(seen.has(slot))throw new CilError('Cyclic MethodImpl slot mapping');
      seen.add(slot);slot=table.aliases.get(slot);
    }
    return table.slots.get(slot);
  }
  resolve(typeToken,methodToken) {
    const declaration=this.definition(methodToken);
    if(!(declaration.flags&virtual))return declaration.token;
    const table=this.table(typeToken);
    if(!table.ancestors.has(declaration.ownerToken))throw new CilError('Virtual receiver is incompatible with the method declaration');
    const slot=this.table(declaration.ownerToken).declarations.get(declaration.token),target=this.resolveSlot(table,slot);
    if(target===undefined)throw new CilError('Virtual method has no implementation');
    return target;
  }
  isAssignable(typeToken,ownerToken,seen=new Set()) {
    if(typeToken===ownerToken)return true;
    const type=this.types.get(typeToken);
    if(!type||seen.has(typeToken))return false;
    if(seen.size>64)throw new CilError('Invalid virtual type hierarchy');
    seen.add(typeToken);
    return this.isAssignable(type.baseToken,ownerToken,seen)||type.interfaces.some(token=>this.isAssignable(token,ownerToken,seen));
  }
  targets(methodToken) {
    if(this.targetCache.has(methodToken))return this.targetCache.get(methodToken);
    const declaration=this.definition(methodToken),targets=new Set();
    for(const type of this.types.values()) {
      if(type.flags&0xa0||!this.isAssignable(type.token,declaration.ownerToken))continue;
      const target=this.resolve(type.token,methodToken),method=this.inspector.methods.get(target);
      if(method?.hasBody&&!(method.flags&0x400))targets.add(target);
    }
    this.targetCache.set(methodToken,targets);return targets;
  }
}
