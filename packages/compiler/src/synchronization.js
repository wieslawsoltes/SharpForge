import {Op,Builtins} from '@sharpforge/bytecode';
import {syncIntrinsicDefinitions} from '@sharpforge/cil';
import {canonicalType,frameworkType} from '@sharpforge/framework';

const pathOf=node=>node?.kind==='Name'?node.name:node?.kind==='Member'&&pathOf(node.target)?pathOf(node.target)+'.'+node.name:null;
const aliases={'System.Object':'object','System.String':'string','System.Boolean':'bool','System.Char':'char','System.SByte':'sbyte','System.Byte':'byte','System.Int16':'short','System.UInt16':'ushort','System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.IntPtr':'nint','System.UIntPtr':'nuint','System.Single':'float','System.Double':'double','System.Decimal':'decimal','System.Void':'void'};
const typeName=type=>type?.endsWith('&')?typeName(type.slice(0,-1))+'&':aliases[type]??canonicalType(type);
const primitive=new Set(['bool','char','sbyte','byte','short','ushort','int','uint','long','ulong','nint','nuint','float','double','decimal','void']);
const descriptorKey=descriptor=>{const signature=descriptor.signature??descriptor;return [descriptor.owner,descriptor.name,signature.parameters.map(typeName).join(','),typeName(signature.returnType),signature.genericArity??0].join('|');};
const defaultBuiltin=descriptor=>Builtins.find(builtin=>builtin.synchronization&&descriptorKey(builtin.synchronization)===descriptorKey(descriptor));
const containsAwait=node=>node&&typeof node==='object'&&(node.kind==='Await'||Object.entries(node).some(([key,value])=>!['source','tokens','symbol','green'].includes(key)&&(Array.isArray(value)?value.some(containsAwait):containsAwait(value))));

/** Independent installer; root owns bytecode/registry/parser integration. */
export function installSynchronizationCompiler(C,{builtinFor=defaultBuiltin,addressOp=Op.ADDRESS}={}) {
  const originalStmt=C.prototype.stmt,originalExpr=C.prototype.expr,originalInfer=C.prototype.infer;
  Object.assign(C.prototype,{
    synchronizationOwner(node) {
      if(node?.kind!=='Member')return null;
      const name=pathOf(node.target);
      if(!/^(?:System\.Threading\.)?(?:Monitor|Interlocked|Volatile|Thread)$/.test(name??''))return null;
      if(!node.boundSynchronization&&(this.lookup(name.split('.')[0])||this.c.typeMap.has(name)))return null;
      return name.startsWith('System.')?name:'System.Threading.'+name;
    },
    synchronizationValueType(type) {
      type=typeName(type);const user=this.c.typeMap.get(type),framework=frameworkType(type);
      return primitive.has(type)||['value','enum'].includes(framework?.kind)||!!user?.valueType||user?.node?.kind==='Struct'||user?.node?.kind==='Enum';
    },
    synchronizationBinding(node,report=false) {
      if(node?.kind!=='Call')return null;
      const owner=this.synchronizationOwner(node.target);if(!owner)return null;
      const templates=syncIntrinsicDefinitions.filter(descriptor=>descriptor.owner===owner&&descriptor.name===node.target.name);
      if(!templates.length)return null;
      const explicit=node.target.typeArguments?.map(type=>typeName(this.c.resolveType(type,node))),first=node.args[0],inferred=first?.kind==='RefArgument'?typeName(this.infer(first.expression)).replace(/&$/,''):null;
      const candidates=[];
      for(const template of templates) {
        const generic=template.genericArity===1;if(explicit&&(!generic||explicit.length!==1))continue;
        const type=generic?(explicit?.[0]??inferred):null;if(generic&&!type)continue;
        const parameters=template.parameters.map(parameter=>parameter.replaceAll('!!0',type??'!!0')),result=template.returnType.replaceAll('!!0',type??'!!0');
        if(parameters.length!==node.args.length)continue;
        let valid=true,score=generic?10:0;
        for(let i=0;i<parameters.length;i++) {
          const parameter=typeName(parameters[i]),argument=node.args[i],byref=parameter.endsWith('&');
          if(byref) {
            const reading=template.name==='Read',modifier=argument?.modifier;
            if(argument?.kind!=='RefArgument'||!(modifier==='ref'||reading&&modifier==='in')||typeName(this.infer(argument.expression)).replace(/&$/,'')!==parameter.slice(0,-1)){valid=false;break;}
          } else {
            if(argument?.kind==='RefArgument'){valid=false;break;}
            const actual=typeName(this.infer(argument));if(actual===parameter)continue;
            // A matching first byref fixes the overload; the normal assignment
            // checker validates later value arguments and constant conversions.
            if(i>0&&parameters[0].endsWith('&')){score++;continue;}
            if(parameter==='object'&&!this.synchronizationValueType(actual)||this.frameworkConversion?.(parameter,actual)){score++;continue;}
            valid=false;break;
          }
        }
        if(valid)candidates.push({template,parameters,result,type,score});
      }
      candidates.sort((a,b)=>a.score-b.score);
      if(!candidates.length){if(report)this.c.report(node,'CS1501',`No supported ${owner}.${node.target.name} overload matches the value and byref arguments`);return {error:true};}
      if(candidates.length>1&&candidates[0].score===candidates[1].score){if(report)this.c.report(node,'CS0121','Ambiguous synchronization overload');return {error:true};}
      const selected=candidates[0];
      if(selected.type&&owner==='System.Threading.Volatile'&&this.synchronizationValueType(selected.type)){if(report)this.c.report(node,'CS0452','Generic Volatile requires a reference type');return {error:true};}
      return selected;
    },
    synchronizationAddress(node,{readonly=false}={}) {
      if(addressOp===undefined)throw new Error('Synchronization compiler requires Op.ADDRESS integration');
      const type=typeName(this.infer(node)).replace(/&$/,''),flag=readonly?4:0;
      if(node?.kind==='BoundTemp'){this.emit(addressOp,flag,node.slot);return type;}
      if(node?.kind==='Name') {
        const local=this.lookup(node.name);
        if(local) {
          if(local.isConst||!readonly&&(local.isUsing||local.isIteration||local.refKind==='in'))this.c.report(node,'CS1657','This local cannot be passed as a writable reference');
          if(!this.assigned.has(local.slot))this.c.report(node,'CS0165',`Use of unassigned local variable '${local.name}'`);
          if(local.symbol)this.c.reference(node,local.symbol);
          if(local.type.endsWith('&'))this.emit(Op.LDLOC,local.slot);else this.emit(addressOp,flag,local.slot);
          return type;
        }
      }
      if(this.property(node)||this.frameworkProperty?.(node)){this.c.report(node,'CS0206','A property cannot be passed by reference');this.emitConstant(null);return 'error';}
      const field=['Name','Member'].includes(node?.kind)?this.field(node):null;
      if(field) {
        if(field.node?.modifiers?.includes('readonly')&&!readonly)this.c.report(node,'CS0192','A readonly field cannot be passed as a writable reference');
        if(field.symbol)this.c.reference(node,field.symbol);
        if(field.isStatic)this.emit(addressOp,1|flag,field.index);
        else {
          const receiver=node.kind==='Member'?node.target:{...node,kind:'Name',name:'this'};
          if(this.synchronizationValueType(this.infer(receiver)))this.synchronizationAddress(receiver,{readonly});else this.expr(receiver);
          this.emit(addressOp,2|flag,field.index);
        }
        return type;
      }
      if(node?.kind==='Index'&&this.infer(node.target).endsWith('[]')) {
        this.expr(node.target);this.checkAssign('int',this.expr(node.index),node.index);this.emit(addressOp,3|flag,0);return type;
      }
      this.c.report(node,'CS1510','A byref argument requires a local, field or array element');this.emitConstant(null);return 'error';
    },
    emitSynchronizationCall(node,binding=this.synchronizationBinding(node,true)) {
      if(binding.error){this.emitConstant(null);return 'error';}
      node.args.forEach((argument,index)=>{
        const expected=typeName(binding.parameters[index]);
        if(expected.endsWith('&'))this.synchronizationAddress(argument.expression,{readonly:argument.modifier==='in'});
        else this.checkAssign(expected,this.typedExpr(argument,expected),argument);
      });
      const builtin=builtinFor(binding.template);
      if(!builtin){this.c.report(node,'SF2163','Synchronization builtin is missing from the registered bytecode profile');for(const argument of node.args)this.emit(Op.POP);this.emitConstant(null);return 'error';}
      this.emit(Op.BUILTIN,builtin.id,node.args.length);return typeName(binding.result);
    },
    synchronizationLock(node) {
      if(containsAwait(node.body))this.c.report(node,'CS1996','Cannot await in the body of a lock statement');
      const type=typeName(this.infer(node.expression));if(this.synchronizationValueType(type))this.c.report(node.expression,'CS0185','A lock statement requires a reference type');
      this.seq({...node,end:node.expression.end});const object=this.temp(type==='null'?'object':type),taken=this.temp('bool'),base={uri:node.uri,start:node.start,end:node.end,debugHidden:true};
      this.expr(node.expression);this.emit(Op.STLOC,object);this.emit(Op.POP);this.emitConstant(false);this.emit(Op.STLOC,taken);this.emit(Op.POP);
      const bound=(slot,type)=>({...base,kind:'BoundTemp',slot,type}),gate=bound(object,this.locals[object].type),flag=bound(taken,'bool');
      const call=(name,args)=>({...base,kind:'ExpressionStatement',expression:{...base,kind:'Call',target:{...base,kind:'Member',boundSynchronization:true,target:{...base,kind:'Name',name:'System.Threading.Monitor'},name},args}});
      const acquire=call('Enter',[gate,{...base,kind:'RefArgument',modifier:'ref',expression:flag}]);
      this.stmt({...base,kind:'Try',body:{...base,kind:'Block',statements:[acquire,node.body]},catches:[],finallyBody:{...base,kind:'If',condition:flag,then:call('Exit',[gate]),otherwise:null}});
      this.clear(object);return undefined;
    },
    infer(node){
      if(node?.kind==='RefArgument')return typeName(this.infer(node.expression)).replace(/&$/,'')+'&';
      const binding=this.synchronizationBinding(node);if(binding)return binding.error?'error':typeName(binding.result);
      if(node?.kind==='Member'&&this.synchronizationOwner(node)==='System.Threading.Monitor'&&node.name==='LockContentionCount')return 'long';
      return originalInfer.call(this,node);
    },
    expr(node){
      const binding=this.synchronizationBinding(node,true);if(binding)return this.emitSynchronizationCall(node,binding);
      if(node?.kind==='RefArgument'){this.c.report(node,'CS1510','A byref expression requires a compatible byref parameter');this.emitConstant(null);return 'error';}
      if(node?.kind==='Member'&&this.synchronizationOwner(node)==='System.Threading.Monitor'&&node.name==='LockContentionCount')return this.emitSynchronizationCall({...node,kind:'Call',target:{...node,name:'get_LockContentionCount'},args:[]});
      return originalExpr.call(this,node);
    },
    stmt(node){return node?.kind==='Lock'?this.synchronizationLock(node):originalStmt.call(this,node);}
  });
}
