import {DiagnosticId} from './diagnostics/codes.js';
import {canonicalType,frameworkType,frameworkAssignable,findContracts,enumValue,enumTypes,eventsFor} from '@sharpforge/framework';
import {Op,frameworkBuiltin} from '@sharpforge/bytecode';
import {typeText} from './type-utils.js';
import {emitValueArgument} from './codegen/value-arguments.js';
import {memberPath as pathOf} from './binder/member-path.js';
import {registeredIndexerContract,prepareRegisteredIndexer} from './framework-indexers.js';
import {frameworkReceiver,frameworkProperty} from './framework-receivers.js';
import {legacyRegisteredField,prepareReadonlyField} from './codegen/registered-fields.js';
/** Closed framework binder layer (class mixin, composed in method-compiler.js); ordinary user members retain precedence. */
export const FrameworkCompiler=Base=>class FrameworkCompiler extends Base {
    frameworkReceiver(node) { return frameworkReceiver(this,node); }
    frameworkProperty(node) { return frameworkProperty(this,node); }
    delegateMethod(node,type,report=false) {
      const contract=frameworkType(type);if(contract?.kind!=='delegate')return null;
      const target=node.kind==='New'&&node.args.length===1?node.args[0]:node;
      let methods=[],receiver=null;
      if(target.kind==='Name'){
        methods=this.c.methodIndex.named(target.name).filter(m=>(m.owner===this.m.owner||!m.owner)&&(!this.m.isStatic||m.isStatic));
      } else if(target.kind==='Member') {
        const owner=this.c.findType(pathOf(target.target),this.m);
        if(owner)methods=owner.methods.filter(m=>m.isStatic&&m.name===target.name);
        else {receiver=target.target;methods=this.c.findType(this.infer(receiver),this.m)?.methods.filter(m=>!m.isStatic&&m.name===target.name)??[];}
      }
      methods=methods.filter(m=>m.parameters.length===contract.parameters.length&&m.parameters.every((p,i)=>this.frameworkConversion(p.type,contract.parameters[i]))&&(contract.result===m.returnType||!['int','double','bool','void'].includes(m.returnType)&&frameworkAssignable(contract.result,m.returnType)));
      const exact=methods.filter(m=>m.returnType===contract.result);if(exact.length===1)methods=exact;if(methods.length!==1){if(report)this.c.report(node,DiagnosticId.CS0123,[target.name??'<expression>',typeText(type)]);return null;}
      return {method:methods[0],receiver,node:target};
    }
    frameworkConversion(target,source) {
      return target===source||target==='double'&&source==='int'||source==='null'&&!['int','double','bool','void'].includes(target)||frameworkAssignable(target,source);
    }
    frameworkCall(node,report=false) {
      const receiver=this.frameworkReceiver(node.target);if(!receiver)return null;
      const types=node.args.map(x=>this.infer(x));
      let candidates=findContracts(receiver.type,node.target.name,receiver.isStatic).filter(d=>d.kind!=='constructor'&&d.parameters.length===types.length&&d.parameters.every((t,i)=>this.frameworkConversion(t,types[i])||this.canTarget(node.args[i],t)||!!this.delegateMethod(node.args[i],t)));
      const exactCandidates=candidates.filter(d=>d.parameters.every((t,i)=>frameworkType(t)?.kind!=='delegate'||this.delegateMethod(node.args[i],t)?.method.returnType===frameworkType(t).result));if(exactCandidates.length)candidates=exactCandidates;
      candidates.sort((a,b)=>a.parameters.reduce((n,t,i)=>n+(t===types[i]?0:1),0)-b.parameters.reduce((n,t,i)=>n+(t===types[i]?0:1),0));
      if(candidates.length>1){const rank=c=>c.parameters.reduce((n,t,i)=>n+(t===types[i]?0:1),0);if(rank(candidates[0])===rank(candidates[1])){if(report)this.c.report(node,DiagnosticId.CS0121,[typeText(candidates[0].owner)+'.'+candidates[0].name,typeText(candidates[1].owner)+'.'+candidates[1].name]);return null;}}
      if(!candidates.length){if(report)this.c.report(node.target.nameSpan?{uri:node.uri,...node.target.nameSpan}:node,DiagnosticId.CS1501,[node.target.name,types.length]);return null;}
      return {receiver,contract:candidates[0]};
    }
    emitDelegate(node,type) {
      const binding=this.delegateMethod(node,type,true);if(!binding){this.emitConstant(null);return type;}
      if(binding.method.isStatic)this.emitConstant(null);
      else if(binding.receiver)this.expr(binding.receiver);
      else {const self=this.lookup('this');if(!self){this.c.report(node,DiagnosticId.CS0120,[binding.method.name]);this.emitConstant(null);}else this.emit(Op.LDLOC,self.slot);}
      this.emit(Op.DELEGATE,binding.method.id,this.c.constant(canonicalType(type)));
      if(binding.method.symbol)this.c.reference(binding.node,binding.method.symbol);
      return canonicalType(type);
    }
    emitFrameworkArguments(args,parameters,boxPrimitives=false) {
      args.forEach((arg,i)=>emitValueArgument(this,arg,parameters[i],boxPrimitives));
    }
    emitContract(contract) {
      const b=frameworkBuiltin(contract);this.emit(Op.BUILTIN,b.id,b.min);return contract.result;
    }
    frameworkInfer(node) {
      if(node.kind==='Index')return registeredIndexerContract(this.infer(node.target),'get')?.result;
      if(node.kind==='Member')return legacyRegisteredField(this,node)?.type??enumValue(pathOf(node))?.type??this.frameworkProperty(node)?.type;
      if(node.kind==='New')return this.c.findType(node.type,this.m)?undefined:frameworkType(node.type)?.name;
      if(node.kind==='Call')return this.frameworkCall(node)?.contract.result;
      return undefined;
    }
    frameworkExpression(node) {
      if(node.kind==='Index'){const get=registeredIndexerContract(this.infer(node.target),'get');if(get){this.expr(node.target);this.checkAssign(get.parameters[0],this.expr(node.index),node.index);return this.emitContract(get);}}
      if(node.kind==='Member') {
        const field = legacyRegisteredField(this,node);
        if (field) {
          this.emitConstant(field.value);
          return field.type;
        }
        const constant=enumValue(pathOf(node));if(constant){this.emit(Op.ENUM,enumTypes.indexOf(constant.type),constant.value);return constant.type;}
        const p=this.frameworkProperty(node);if(p){if(!p.get){this.c.report(node,DiagnosticId.CS0154,[node.name]);this.emitConstant(null);return p.type;}if(!p.receiver.isStatic)this.expr(p.receiver.node);return this.emitContract(p.get);}
      }
      if(node.kind==='Call') {
        const r=this.frameworkReceiver(node.target);if(!r)return undefined;
        if(!findContracts(r.type,node.target.name,r.isStatic).length&&this.findBuiltin(node))return undefined;
        const call=this.frameworkCall(node,true);if(!call){this.emitConstant(null);return 'error';}
        if(!call.receiver.isStatic)this.expr(call.receiver.node);
        this.emitFrameworkArguments(node.args,call.contract.parameters,frameworkType(call.contract.owner)?.kind==='bcl');return this.emitContract(call.contract);
      }
      if(node.kind==='New') {
        const t=this.c.findType(node.type,this.m)?null:frameworkType(node.type);if(!t)return undefined;
        if(t.kind==='delegate')return this.emitDelegate(node,t.name);
        const candidates=findContracts(t.name,'.ctor',false).filter(d=>d.owner===t.name&&d.parameters.length===node.args.length&&d.parameters.every((p,i)=>this.frameworkConversion(p,this.infer(node.args[i]))||this.canTarget(node.args[i],p)||this.delegateMethod(node.args[i],p)));
        if(candidates.length!==1){this.c.report(node,DiagnosticId.CS1729,[typeText(t.name),node.args.length]);this.emitConstant(null);return t.name;}
        this.emitFrameworkArguments(node.args,candidates[0].parameters,t.kind==='bcl');this.emitContract(candidates[0]);
        if(node.initializers.length){const slot=this.temp(t.name);this.emit(Op.STLOC,slot);this.emit(Op.POP);
          for(const init of node.initializers){const setter=findContracts(t.name,'set_'+init.name,false)[0];if(!setter){this.c.report(init,DiagnosticId.CS0200,[typeText(t.name)+'.'+init.name]);continue;}this.emit(Op.LDLOC,slot);this.checkAssign(setter.parameters[0],this.expr(init.expression),init);this.emitContract(setter);this.emit(Op.POP);}
          this.emit(Op.LDLOC,slot);this.clear(slot);
        }
        if(node.collectionInitializers?.length){const slot=this.temp(t.name);this.emit(Op.STLOC,slot);this.emit(Op.POP);for(const values of node.collectionInitializers){const candidates=findContracts(t.name,'Add',false).filter(d=>d.parameters.length===values.length&&d.parameters.every((p,i)=>this.frameworkConversion(p,this.infer(values[i]))));if(candidates.length!==1){this.c.report(node,DiagnosticId.CS1921,[typeText(t.name)+'.Add']);continue;}this.emit(Op.LDLOC,slot);this.emitFrameworkArguments(values,candidates[0].parameters,t.kind==='bcl');this.emitContract(candidates[0]);this.emit(Op.POP);}this.emit(Op.LDLOC,slot);this.clear(slot);}
        return t.name;
      }
      if(node.kind==='Assignment'&&['+=','-='].includes(node.operator)) {
        const r=this.frameworkReceiver(node.left),event=r&&!r.isStatic?eventsFor(r.type)[node.left.name]:null;
        if(event){const d=findContracts(r.type,(node.operator==='+='?'add_':'remove_')+node.left.name,false)[0];this.expr(r.node);this.emitDelegate(node.right,event);this.emitContract(d);return 'void';}
      }
      return undefined;
    }
    prepareFramework(node) {
      if(node.kind==='Index')return prepareRegisteredIndexer(this,node);
      const field = legacyRegisteredField(this,node);
      if (field) return prepareReadonlyField(this,node,field);
      const p=this.frameworkProperty(node);if(!p)return null;
      if(!p.set)this.c.report(node,DiagnosticId.CS0200,[node.name]);
      let receiver=null;if(!p.receiver.isStatic){this.expr(p.receiver.node);receiver=this.temp(p.receiver.type);this.emit(Op.STLOC,receiver);this.emit(Op.POP);}
      return {kind:'framework',property:p,type:p.type,receiver};
    }
    loadFramework(ref) {
      if(!ref.property.get){this.emitConstant(null);return;}if(ref.receiver!==null)this.emit(Op.LDLOC,ref.receiver);if(ref.key!==undefined)this.emit(Op.LDLOC,ref.key);this.emitContract(ref.property.get);
    }
    storeFramework(ref) {
      const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);
      if(ref.property.set){if(ref.receiver!==null)this.emit(Op.LDLOC,ref.receiver);if(ref.key!==undefined)this.emit(Op.LDLOC,ref.key);this.emit(Op.LDLOC,value);this.emitContract(ref.property.set);this.emit(Op.POP);}
      this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);if(ref.key!==undefined)this.clear(ref.key);
    }
};
