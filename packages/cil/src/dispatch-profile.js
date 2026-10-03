import {CilError} from './binary.js';
import {decodeCoded,token} from './metadata.js';
import {genericTypeParts} from './field-profile.js';
import {resolveExecutionMethod,instantiateSignature,callSignatureKey,substituteCallType,normalizeCallType} from './call-profile.js';

const virtual=0x40,newslot=0x100,final=0x20;
const signatureKey=signature=>callSignatureKey(signature)+'/'+(signature.genericArity??0);
/** Declaration slots include their closed declaring type, so I<int> and I<string>
 * remain distinct even when they share the same MethodDef. */
export class CilDispatchTable {
  constructor(inspector) {
    this.inspector=inspector;this.types=new Map(inspector.types.map(type=>[type.token,type]));this.names=new Map(inspector.types.map(type=>[type.name,type]));this.resolutions=new Map();this.externalResolutions=new Map();
    this.externalInterfaces=new Set(inspector.types.flatMap(type=>type.interfaces.map(token=>genericTypeParts(inspector.metadata.typeName(token)).definition)));
    this.externalMethods=(inspector.metadata.rows[10]??[]).map((_,index)=>inspector.resolveToken(token(10,index+1))).filter(member=>member.kind==='method'&&!member.resolvedToken&&this.externalInterfaces.has(genericTypeParts(member.owner).definition));
    this.tables=new Map();this.building=new Set();this.implementations=new Map();this.targetCache=new Map();
    for(const row of inspector.metadata.rows?.[25]??[]) {
      const owner=token(2,row[0]);if(!this.implementations.has(owner))this.implementations.set(owner,[]);
      this.implementations.get(owner).push({body:decodeCoded('MethodDefOrRef',row[1]),declaration:decodeCoded('MethodDefOrRef',row[2])});
    }
  }
  definition(methodToken,context={}) {
    const descriptor=resolveExecutionMethod(this.inspector,methodToken,context),method=this.inspector.methods.get(descriptor.resolvedToken);
    if(!method){if(this.externalInterfaces.has(genericTypeParts(descriptor.owner).definition))return {...descriptor,flags:virtual,external:true,ownerInstance:descriptor.ownerInstance??descriptor.owner};throw new CilError('External virtual declarations are not executable');}
    return {...method,signature:descriptor.signature,ownerInstance:descriptor.ownerInstance};
  }
  typeContext(input) {
    if(!input)return {name:'',type:null,arguments:[]};
    const rawName=typeof input==='number'?this.inspector.metadata.typeName(input):input,name=rawName.includes('<')?normalizeCallType(rawName):rawName,parts=genericTypeParts(name),type=this.names.get(parts.definition);
    const arity=Number(parts.definition.match(/`(\d+)$/)?.[1]??0),args=parts.arguments.length?parts.arguments:Array.from({length:arity},(_,index)=>'!'+index);
    return {name:args.length?parts.definition+'<'+args.join(',')+'>':name,type,arguments:args};
  }
  table(input) {
    const context=this.typeContext(input),{type,name}=context;
    if(this.tables.has(name))return this.tables.get(name);
    if(!type) {
      const table={slots:new Map(),aliases:new Map(),declarations:new Map(),visible:new Map(),ancestors:new Set(),instances:new Set(name?[name]:[])};
      if(this.externalInterfaces.has(genericTypeParts(name).definition))for(const method of this.externalMethods) {
        const owner=genericTypeParts(method.owner);if(owner.definition!==genericTypeParts(name).definition)continue;
        if(owner.arguments.length&&!owner.arguments.some(argument=>/!\d+/.test(argument))&&normalizeCallType(owner.arguments.join(','))!==normalizeCallType(context.arguments.join(',')))continue;
        const signature=instantiateSignature(method.signature,context.arguments),slot='external:'+name+'::'+method.name+'::'+signatureKey(signature);
        table.declarations.set(slot,{token:method.token,name:method.name,owner:name,slot,signature,external:true});
      }
      this.tables.set(name,table);return table;
    }
    if(this.building.has(name)||this.building.size>64)throw new CilError('Invalid virtual type hierarchy');
    this.building.add(name);
    try {
      const inheritedName=token=>substituteCallType(this.inspector.metadata.typeName(token),context.arguments);
      const base=this.table(type.baseToken?inheritedName(type.baseToken):null),slots=new Map(base.slots),aliases=new Map(base.aliases),declarations=new Map(base.declarations),visible=new Map(base.visible),ancestors=new Set(base.ancestors),instances=new Set(base.instances);
      ancestors.add(type.token);instances.add(name);const interfaces=[];
      for(const interfaceToken of type.interfaces) {
        const inherited=this.table(inheritedName(interfaceToken));interfaces.push(inherited);
        for(const ancestor of inherited.ancestors)ancestors.add(ancestor);
        for(const instance of inherited.instances)instances.add(instance);
        for(const [key,declaration] of inherited.declarations)declarations.set(key,declaration);
        if(type.flags&0x20) {
          for(const [slot,body] of inherited.slots)slots.set(slot,body);
          for(const [slot,body] of inherited.aliases)aliases.set(slot,body);
          for(const [key,slot] of inherited.visible)visible.set(key,slot);
        }
      }
      for(const method of type.methods) {
        if(!(method.flags&virtual)||method.flags&0x10)continue;
        const signature=instantiateSignature(this.inspector.signature(method.token),context.arguments),key=method.name+'::'+signatureKey(signature),declarationKey=name+'::'+method.token;
        const inherited=method.flags&newslot?undefined:visible.get(key),slot=inherited??declarationKey;
        if(inherited!==undefined&&this.inspector.methods.get(this.resolveSlot({slots,aliases},slot))?.flags&final)throw new CilError('A final virtual method cannot be overridden');
        aliases.delete(slot);slots.set(slot,method.token);declarations.set(declarationKey,{token:method.token,owner:name,slot,signature});visible.set(key,slot);
      }
      for(const iface of interfaces)for(const declaration of iface.declarations.values()) {
        const method=this.inspector.methods.get(declaration.token),key=(method?.name??declaration.name)+'::'+signatureKey(declaration.signature),implementation=visible.get(key);
        if(implementation!==undefined){slots.set(declaration.slot,slots.get(implementation));if(declaration.slot!==implementation)aliases.set(declaration.slot,implementation);}
      }
      const explicit=new Set();
      for(const implementation of this.implementations.get(type.token)??[]) {
        const callContext={ownerToken:type.token,genericIdentity:name,typeArguments:context.arguments};
        const declaration=this.definition(implementation.declaration,callContext),body=this.definition(implementation.body,callContext);
        if(!(declaration.flags&virtual)||declaration.flags&0x10||body.flags&0x10||!(declaration.external?instances.has(this.typeContext(declaration.ownerInstance).name):ancestors.has(declaration.ownerToken))||!ancestors.has(body.ownerToken))throw new CilError('Invalid MethodImpl owner or virtual declaration');
        if(signatureKey(declaration.signature)!==signatureKey(body.signature))throw new CilError('MethodImpl signatures do not match');
        const candidates=[...declarations.values()].filter(item=>(declaration.external?item.external&&item.name===declaration.name&&signatureKey(item.signature)===signatureKey(declaration.signature):item.token===declaration.token)&&(!declaration.ownerInstance||item.owner===this.typeContext(declaration.ownerInstance).name));
        if(candidates.length!==1||explicit.has(candidates[0].slot))throw new CilError('Invalid or duplicate MethodImpl declaration');
        const slot=candidates[0].slot,previous=this.resolveSlot(base,slot);
        if(!declaration.external&&!(this.types.get(declaration.ownerToken)?.flags&0x20)&&previous!==undefined&&this.inspector.methods.get(previous)?.flags&final)throw new CilError('A final virtual method cannot be overridden');
        const bodySlot=[...declarations.values()].find(item=>item.token===body.token&&item.owner===name)?.slot;
        explicit.add(slot);slots.set(slot,body.token);if(bodySlot!==undefined&&bodySlot!==slot)aliases.set(slot,bodySlot);else aliases.delete(slot);
      }
      const table={slots,aliases,declarations,visible,ancestors,instances};this.tables.set(name,table);return table;
    } finally {this.building.delete(name);}
  }
  resolveSlot(table,slot) {
    const seen=new Set();while(table.aliases.has(slot)){if(seen.has(slot))throw new CilError('Cyclic MethodImpl slot mapping');seen.add(slot);slot=table.aliases.get(slot);}return table.slots.get(slot);
  }
  resolve(type,methodToken,ownerInstance=null) {
    const key=JSON.stringify([type,methodToken,ownerInstance]);if(this.resolutions.has(key))return this.resolutions.get(key);
    const declaration=this.definition(methodToken);if(!(declaration.flags&virtual))return declaration.token;
    const table=this.table(type),instance=ownerInstance?this.typeContext(ownerInstance).name:null;
    const candidates=[...table.declarations.values()].filter(item=>item.token===declaration.token&&(!instance||item.owner===instance));
    if(candidates.length!==1)throw new CilError('Virtual receiver is incompatible or ambiguous for the method declaration');
    const target=this.resolveSlot(table,candidates[0].slot);if(target===undefined)throw new CilError('Virtual method has no implementation');this.resolutions.set(key,target);return target;
  }
  externalTarget(type,descriptor) {
    const key=JSON.stringify([type,descriptor.ownerInstance??descriptor.owner,descriptor.name,signatureKey(descriptor.signature)]);if(this.externalResolutions.has(key))return this.externalResolutions.get(key);
    const table=this.table(type),owner=this.typeContext(descriptor.ownerInstance??descriptor.owner).name;
    const declaration=[...table.declarations.values()].find(item=>item.external&&item.owner===owner&&item.name===descriptor.name&&signatureKey(instantiateSignature(item.signature,[],descriptor.methodArguments))===signatureKey(descriptor.signature));
    const target=declaration?this.resolveSlot(table,declaration.slot)??null:null;this.externalResolutions.set(key,target);return target;
  }
  externalTargets(descriptor) {
    const targets=new Set(),owner=genericTypeParts(descriptor.owner).definition;
    for(const type of this.types.values()) {
      if(type.flags&0xa0)continue;
      const table=this.table(type.token);
      for(const declaration of table.declarations.values())if(declaration.external&&genericTypeParts(declaration.owner).definition===owner&&declaration.name===descriptor.name) {
        const target=this.resolveSlot(table,declaration.slot);if(this.inspector.methods.get(target)?.hasBody)targets.add(target);
      }
    }
    return targets;
  }
  isAssignable(typeToken,ownerToken) {return this.table(typeToken).ancestors.has(ownerToken);}
  targets(methodToken) {
    if(this.targetCache.has(methodToken))return this.targetCache.get(methodToken);
    const declaration=this.definition(methodToken),targets=new Set();
    for(const type of this.types.values()) {
      if(type.flags&0xa0)continue;
      const table=this.table(type.token);if(!table.ancestors.has(declaration.ownerToken))continue;
      for(const candidate of table.declarations.values())if(candidate.token===declaration.token) {
        const target=this.resolveSlot(table,candidate.slot),method=this.inspector.methods.get(target);
        if(method?.hasBody&&!(method.flags&0x400))targets.add(target);
      }
    }
    this.targetCache.set(methodToken,targets);return targets;
  }
}
