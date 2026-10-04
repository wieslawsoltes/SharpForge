import {DiagnosticId} from './diagnostics/codes.js';
import {dispatchStatement,dispatchInference,dispatchExpression} from './dispatch.js';
import {frameworkType,findContracts} from '@sharpforge/framework';
import {Op,Binary,Unary,BuiltinMap} from '@sharpforge/bytecode';
import {evaluateConstant,ConstantError} from './constants.js';
import {numeric,isReference,assignable,defaultValue,alwaysReturns,pathOf,typeText,usingSpan} from './type-utils.js';
import {FrameworkCompiler} from './framework.js';
import {ModernCompiler} from './modern.js';
import {CallScopedInference} from './binder/inference-cache.js';
/** Core statement/expression compiler for the string-typed profile; framework and modern layers are composed below. */
class CoreMethodCompiler {
  constructor(compilation,method){this.c=compilation;this.m=method;this.code=[];this.locals=[];this.scopes=[new Map()];this.assigned=new Set();this.loops=[];this.handlers=[];this.catchDepth=0;this.finallyScopes=[];this.checkedContext=null;this.constantDiagnostics=new Set();
    if(!method.isStatic)this.local('this',method.owner.name,method.node,true,true);
    for(const p of method.parameters)this.local(p.name,p.type,p,true);
  }
  get pc(){return this.code.length/3;}
  emit(op,a=0,b=0){const at=this.pc;this.code.push(op,a,b);return at;}
  patch(at,target=this.pc){this.code[at*3+1]=target;}
  emitConstant(value,type){this.emit(Op.CONST,this.c.constant(value),type==='double'?1:0);}
  clear(slot){if(!isReference(this.locals[slot].type))return;this.emitConstant(null);this.emit(Op.STLOC,slot);this.emit(Op.POP);}
  temp(type='object'){const slot=this.locals.length;this.locals.push({name:`$t${slot}`,type,slot,hidden:true});return slot;}
  local(name,type,node,assigned=false,hidden=false){
    if(this.scopes.some(s=>s.has(name)))this.c.report(node,DiagnosticId.CS0136,[name]);
    const slot=this.locals.length,symbol=hidden?null:this.c.symbol({...node,name},'local',type,{method:this.m.qualifiedName,scopeStart:this.scopeNode?.start??this.m.node.start,scopeEnd:this.scopeNode?.end??this.m.node.end});
    const local={name,type,slot,symbol,hidden,scopeStartPc:this.pc,isConst:node.isConst??false,isUsing:node.isUsing??false,isIteration:node.isIteration??false,declaredAt:node.start,scopeEnd:this.scopeNode?.end??this.m.node.end};this.locals.push(local);this.scopes.at(-1).set(name,local);if(assigned)this.assigned.add(slot);return local;
  }
  closeScope(){const scope=this.scopes.pop();for(const l of scope.values())l.scopeEndPc=this.pc;return scope;}
  lookup(name){for(let i=this.scopes.length-1;i>=0;i--){const l=this.scopes[i].get(name);if(l)return l;}return null;}
  seq(node){if(node.debugHidden)return;const source=this.c.sources.get(node.uri);if(!source)return;const pos=source.positionAt(node.start),point={id:this.c.sequencePoints.length,methodId:this.m.id,offset:this.pc,uri:node.uri,start:node.start,end:node.end,line:pos.line+1,column:pos.character+1};this.c.sequencePoints.push(point);this.emit(Op.SEQ,point.id);}
  build(){this.stmt(this.m.node.body);if(this.m.returnType!=='void'&&!alwaysReturns(this.m.node.body))this.c.report(this.m.node,DiagnosticId.CS0161,[this.m.qualifiedName]);this.emitConstant(defaultValue(this.m.returnType));this.emit(Op.RET);this.finish();}
  finish(){this.m.code=Int32Array.from(this.code);this.m.locals=this.locals.map(({symbol,...l})=>({...l,...(!l.hidden?{scopeEndPc:l.scopeEndPc??this.pc}:{})}));this.m.handlers=this.handlers;}
  checkAssign(target,from,node){if(!assignable(target,from))this.c.report(node,DiagnosticId.CS0029,[typeText(from),typeText(target)]);}
  bool(node){const t=this.expr(node);this.checkAssign('bool',t,node);}
  stmt(node){if(!node)return;
    return dispatchStatement(this,node);
  }
  statementList(statements){
    for(let i=0;i<statements.length;i++){const s=statements[i];if(s.kind==='UsingDeclaration'){this.stmt({...s,kind:'Using',body:{...s,kind:'Block',end:statements.at(-1)?.end??s.end,statements:statements.slice(i+1)}});return;}this.stmt(s);}
  }
  lowerUsing(node){
    if(node.resources.kind==='Local'&&node.resources.declarations.length>1&&node.resources.declarations.some(d=>d.type==='var'))this.c.report(node,DiagnosticId.CS0819);
    const declarations=node.resources.kind==='Local'?node.resources.declarations:[{...node.resources,kind:'Variable',name:`$using${this.locals.length}_${this.pc}`,type:'var',initializer:node.resources,hidden:true}];
    const lower=index=>{
      if(index>=declarations.length)return node.body;
      const d=declarations[index],type=d.type==='var'?this.infer(d.initializer):this.c.typeName(d.type,this.m),owner=this.c.findType(type,this.m);
      if(!d.initializer)this.c.report(d,DiagnosticId.CS0210);
      if(!owner?.interfaces.includes('System.IDisposable')&&!(['network','bcl','bcl14'].includes(frameworkType(type)?.kind)&&findContracts(type,'Dispose',false).some(c=>!c.parameters.length)))this.c.report(usingSpan(node,d),DiagnosticId.CS1674,[typeText(type)]);
      const name={...d,kind:'Name',name:d.name},nil={...d,kind:'Literal',type:'null',value:null};
      const dispose={...d,debugHidden:true,kind:'ExpressionStatement',expression:{...d,kind:'Call',target:{...d,kind:'Member',target:name,name:'Dispose'},args:[]}};
      return {...node,kind:'Block',statements:[{...d,kind:'Local',declarations:[{...d,isUsing:true}]},{...node,kind:'Try',body:lower(index+1),catches:[],finallyBody:{...d,kind:'Block',statements:[{...d,debugHidden:true,kind:'If',condition:{...d,kind:'Binary',operator:'!=',left:name,right:nil},then:dispose,otherwise:null}]}}]};
    };
    return lower(0);
  }
  constantPattern(node){
    if(this.isNameof(node))return {value:this.nameof(node),type:'string'};
    const result=this.constant(node);
    if(result&&['int','string','bool','null'].includes(result.type)){
      const visit=n=>{if(!n||typeof n!=='object')return;if(n.kind==='Name'){const local=this.lookup(n.name);if(local?.constantValue&&local.symbol)this.c.reference(n,local.symbol);}for(const [key,value]of Object.entries(n))if(!['green','tokens','source'].includes(key))for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&child.kind)visit(child);};visit(node);return result;
    }
    this.c.report(node??this.m.node,DiagnosticId.CS0150);return {value:null,type:'error'};
  }
  switchDispatch(node,groups){
    this.seq({...node,end:node.expression.end});const type=this.expr(node.expression),slot=this.temp(type);if(!['int','string','bool'].includes(type))this.c.report(node,DiagnosticId.CS0151);this.emit(Op.STLOC,slot);this.emit(Op.POP);
    const branches=groups.map(()=>[]),seen=new Set();let fallback=-1;
    groups.forEach((labels,index)=>labels.forEach(label=>{if(label===null){if(fallback>=0)this.c.report(node,DiagnosticId.CS0152,['default']);fallback=index;return;}const constant=this.constantPattern(label),key=JSON.stringify([constant.type,constant.value]);if(seen.has(key))this.c.report(label,DiagnosticId.CS0152,[String(constant.value)]);seen.add(key);this.checkAssign(type,constant.type,label);this.emit(Op.LDLOC,slot);this.emitConstant(constant.value,constant.type);this.emit(Op.BINARY,Binary['==']);branches[index].push(this.emit(Op.JTRUE));}));
    return {branches,fallback,otherwise:this.emit(Op.JUMP),slot};
  }
  switchStatement(node){
    const before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.sections.map(s=>s.labels)),loop={switch:true,breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.scopes.push(new Map());
    const ends=[];node.sections.forEach((section,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);for(const s of section.statements)this.stmt(s);const terminal=s=>alwaysReturns(s)||['Break','Continue'].includes(s?.kind)||s?.kind==='Block'&&terminal(s.statements.at(-1))||s?.kind==='If'&&terminal(s.then)&&terminal(s.otherwise);if(section.statements.length&&!terminal(section.statements.at(-1)))this.c.report(section,DiagnosticId.CS0163,[this.c.caseLabel(section)]);ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0)this.patch(dispatch.otherwise);for(const p of [...ends,...loop.breaks])this.patch(p);this.loops.pop();for(const local of this.scopes.at(-1).values())this.clear(local.slot);this.closeScope();this.clear(dispatch.slot);this.assigned=before;
  }
  switchType(node){const types=node.arms.map(a=>this.infer(a.expression));return types.includes('double')&&types.every(t=>numeric(t))?'double':types.find(t=>t!=='null')??'error';}
  switchExpression(node){
    const type=this.switchType(node),before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.arms.map(a=>[a.pattern])),ends=[],assigned=[];
    node.arms.forEach((arm,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);this.checkAssign(type,this.expr(arm.expression),arm);assigned.push(new Set(this.assigned));ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0){this.patch(dispatch.otherwise);this.emitConstant('No switch expression arm matched.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);this.emit(Op.THROW);}
    for(const p of ends)this.patch(p);this.clear(dispatch.slot);this.assigned=assigned.length?new Set([...assigned[0]].filter(x=>assigned.every(s=>s.has(x)))):before;return type;
  }
  property(node){
    if(node.kind==='Name')return this.lookup(node.name)?null:this.m.owner?.properties.find(p=>p.name===node.name)??null;
    if(node.kind!=='Member')return null;
    const named=this.c.findType(pathOf(node.target),this.m);if(named)return named.properties.find(p=>p.name===node.name&&p.isStatic)??null;
    return this.c.findType(this.infer(node.target),this.m)?.properties.find(p=>p.name===node.name&&!p.isStatic)??null;
  }
  propertyAccess(property,node,kind){
    const method=property[kind];this.c.reference(node,property.symbol);
    if(!method){this.c.report(node,kind==='get'?DiagnosticId.CS0154:DiagnosticId.CS0200,[property.name]);return null;}
    if(['private','protected'].includes(method.accessor.access)&&this.m.owner!==property.owner)this.c.report(node,kind==='get'?DiagnosticId.CS0271:DiagnosticId.CS0272,[property.name]);
    if(!property.isStatic&&node.kind==='Name'&&!this.lookup('this'))this.c.report(node,DiagnosticId.CS0120,[property.name]);
    return method;
  }
  propertyReceiver(property,node){if(!property.isStatic){if(node.kind==='Member')this.expr(node.target);else this.emit(Op.LDLOC,this.lookup('this')?.slot??0);}}
  readProperty(property,node){const getter=this.propertyAccess(property,node,'get');if(getter){this.propertyReceiver(property,node);this.emit(Op.CALL,getter.id,property.isStatic?0:1);}else this.emitConstant(null);return property.type;}
  field(node){
    if(node.kind==='Name')return this.m.owner?.fields.find(f=>f.name===node.name)??null;
    const path=pathOf(node.target),owner=this.c.findType(path,this.m);if(owner)return owner.fields.find(f=>f.name===node.name&&f.isStatic)??null;
    const type=this.infer(node.target);return this.c.findType(type,this.m)?.fields.find(f=>f.name===node.name&&!f.isStatic)??null;
  }
  isNameof(node){return node?.kind==='Call'&&node.target.kind==='Name'&&node.target.name==='nameof'&&!this.c.methodIndex.named('nameof').some(m=>m.owner===this.m.owner||!m.owner);}
  nameof(node,bind=true){
    const argument=node.args[0];if(node.args.length!==1||!argument||!['Name','Member'].includes(argument.kind)){if(bind)this.c.report(node,DiagnosticId.CS8081);return '';}
    // The restricted profile supports identifier/member chains, not arbitrary receiver expressions.
    const path=pathOf(argument);if(!path||path.includes('null.')){if(bind)this.c.report(argument,DiagnosticId.CS8081);return '';}
    let symbol=null,valid=false;
    if(argument.kind==='Name'){
      const local=this.lookup(argument.name),field=this.m.owner?.fields.find(f=>f.name===argument.name)??this.m.owner?.properties.find(p=>p.name===argument.name),type=this.c.findType(argument.name,this.m),methods=this.c.methods.filter(m=>m.name===argument.name&&(m.owner===this.m.owner||!m.owner));
      symbol=local?.symbol??field?.symbol??type?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!local||!!field||!!type||methods.length>0||['System','Console','Math','GC','Array','Convert','Debug','Exception'].includes(argument.name);
    }else{
      const receiver=pathOf(argument.target),local=argument.target.kind==='Name'?this.lookup(receiver):null,type=this.c.findType(receiver??'',this.m)??this.c.findType(this.infer(argument.target),this.m),field=type?.fields.find(f=>f.name===argument.name)??type?.properties.find(p=>p.name===argument.name),methods=type?.methods.filter(m=>m.name===argument.name)??[];
      symbol=field?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!field||methods.length>0||BuiltinMap.has(path.replace(/^System\./,''))||path==='System.Console'||path==='System.Math'||path==='System.GC'||path==='System.Exception'||path==='System.String'||path==='System.Int32'||argument.name==='Length'&&(local?.type==='string'||local?.type?.endsWith('[]'));
      if(bind&&local?.symbol)this.c.reference(argument.target,local.symbol);
    }
    if(!valid&&bind)this.c.report(argument,DiagnosticId.CS0103,[path]);
    if(bind&&symbol)this.c.reference(argument,symbol);return argument.name;
  }
  infer(node){
    if(!node)return 'error';const external=this.frameworkInfer(node);if(external!==undefined)return external;return dispatchInference(this,node);
  }
  findBuiltin(node){
    let name=pathOf(node.target);if(name?.startsWith('System.'))name=name.slice(7);if(BuiltinMap.has(name))return BuiltinMap.get(name);
    if(node.target.kind==='Member'){const receiver=this.infer(node.target.target);if(frameworkType(receiver)?.kind==='enum'&&node.target.name==='HasFlag')return BuiltinMap.get('Enum.HasFlag');if(receiver==='string'&&BuiltinMap.has('string.'+node.target.name))return BuiltinMap.get('string.'+node.target.name);if(node.target.name==='GetType')return BuiltinMap.get('object.GetType');if(node.target.name==='ToString')return BuiltinMap.get('object.ToString');}return null;
  }
  findMethod(node,report=true){
    let candidates=[];const target=node.target;
    if(target.kind==='Name')candidates=this.c.methodIndex.named(target.name).filter(m=>(m.owner===this.m.owner||!m.owner)&&(!this.m.isStatic||m.isStatic));
    else if(target.kind==='Member'){const path=pathOf(target.target),type=this.c.findType(path,this.m);if(type)candidates=type.methods.filter(m=>m.name===target.name&&m.isStatic);else{const type=this.c.findType(this.infer(target.target),this.m);candidates=type?.methods.filter(m=>m.name===target.name&&!m.isStatic)??[];}}
    if(candidates.some(m=>m.accessor)){if(report)this.c.report(node,DiagnosticId.CS0571,[pathOf(target)??target.name]);candidates=candidates.filter(m=>!m.accessor);}
    const types=node.args.map(a=>this.infer(a));candidates=candidates.filter(m=>m.parameters.length===types.length&&m.parameters.every((p,i)=>assignable(p.type,types[i])));
    candidates.sort((a,b)=>a.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)-b.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0));
    if(!candidates.length&&report)this.c.report(node,DiagnosticId.CS1501,[target.name??'<expression>',node.args.length]);
    if(candidates.length>1&&candidates[0].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)===candidates[1].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)&&report)this.c.report(node,DiagnosticId.CS0121,[candidates[0].qualifiedName,candidates[1].qualifiedName]);
    return candidates[0]??null;
  }
  overflowChecked(node){return this.checkedContext??this.c.options.checkOverflowByUri?.[node?.uri??this.m.node.uri]??this.c.options.checkOverflow??false;}
  constant(node){try{return evaluateConstant(node,{checked:this.checkedContext!==false,resolve:n=>n.kind==='Name'?this.lookup(n.name)?.constantValue??null:null});}catch(error){if(!(error instanceof ConstantError))throw error;const key=error.node.start+':'+error.code;if(!this.constantDiagnostics.has(key)){this.constantDiagnostics.add(key);this.c.report(error.node,error.code,error.args);}return null;}}
  expr(node){
    if(!node){this.emitConstant(null);return 'error';}const external=this.frameworkExpression(node);if(external!==undefined)return external;
    if(['Binary','Unary','Cast'].includes(node.kind))this.constant(node);
    return dispatchExpression(this,node);
  }
  binary(operator,left,right,node){
    if(frameworkType(left)?.family==='vector'&&left===right){const name={'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','&':'BitwiseAnd','^':'Xor','==':'EqualsAll','!=':'EqualsAll'}[operator],contract=name&&findContracts('System.Numerics.Vector',name,true).find(d=>d.parameters[0]===left);if(contract){this.emitContract(contract);if(operator==='!=')this.emit(Op.UNARY,Unary['!']);return contract.result;}}
    let result;
    if(operator==='+'&&(left==='string'||right==='string'))result='string';
    else if(['==','!='].includes(operator)){if(!assignable(left,right)&&!assignable(right,left))this.c.report(node,DiagnosticId.CS0019,[operator,typeText(left),typeText(right)]);result='bool';}
    else if(['&','|','^'].includes(operator)&&left==='bool'&&right==='bool')result='bool';
    else {if(!numeric(left)||!numeric(right))this.c.report(node,DiagnosticId.CS0019,[operator,typeText(left),typeText(right)]);if(['&','|','^','<<','>>'].includes(operator)&&(left!=='int'||right!=='int'))this.c.report(node,DiagnosticId.CS0019,[operator,typeText(left),typeText(right)]);result=['<','<=','>','>='].includes(operator)?'bool':left==='double'||right==='double'?'double':'int';}
    if(!(operator in Binary)){this.c.report(node,DiagnosticId.SF2006,[operator]);this.emit(Op.POP);return 'error';}
    this.emit(Op.BINARY,Binary[operator],result==='int'?(this.overflowChecked(node)&&['+','-','*'].includes(operator)?5:1):result==='string'?2:result==='bool'&&left==='bool'?3:0);return result;
  }
  prepare(node,allowReadOnly=false){const framework=this.prepareFramework(node);if(framework)return framework;
    if(node.kind==='Name'){const l=this.lookup(node.name);if(l){if(l.isConst)this.c.report(node,DiagnosticId.CS0131);if(l.isUsing)this.c.report(node,DiagnosticId.CS1656,[node.name,'using variable']);if(l.isIteration)this.c.report(node,DiagnosticId.CS1656,[node.name,'foreach iteration variable']);if(l.symbol)this.c.reference(node,l.symbol);return {kind:'local',...l};}}
    const property=this.property(node);
    if(property){
      // A getter-only auto-property may be assigned only on this in its owning constructor.
      if(allowReadOnly&&!property.set&&property.backing&&this.m.owner===property.owner&&this.m.name==='.ctor'&&!property.isStatic&&(node.kind==='Name'||node.target?.kind==='Name'&&node.target.name==='this')){
        this.c.reference(node,property.symbol);this.emit(Op.LDLOC,this.lookup('this').slot);const receiver=this.temp(property.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);return {kind:'field',type:property.type,index:property.backing.index,receiver};
      }
      this.propertyAccess(property,node,'set');let receiver=null;
      if(!property.isStatic){this.propertyReceiver(property,node);receiver=this.temp(property.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);}
      return {kind:'property',property,node,type:property.type,receiver};
    }
    const f=(node.kind==='Name'||node.kind==='Member')?this.field(node):null;
    if(f){this.c.reference(node,f.symbol);if(f.isStatic)return {kind:'static',type:f.type,index:f.index};if(node.kind==='Member')this.expr(node.target);else{const self=this.lookup('this');if(!self)this.c.report(node,DiagnosticId.CS0120,[node.name]);this.emit(Op.LDLOC,self?.slot??0);}const receiver=this.temp(f.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);return {kind:'field',type:f.type,index:f.index,receiver};}
    if(node.kind==='Index'){const type=this.expr(node.target),receiver=this.temp(type);this.emit(Op.STLOC,receiver);this.emit(Op.POP);this.checkAssign('int',this.expr(node.index),node.index);const index=this.temp('int');this.emit(Op.STLOC,index);this.emit(Op.POP);if(!type.endsWith('[]'))this.c.report(node,DiagnosticId.CS0021,[typeText(type)]);return {kind:'index',type:type.slice(0,-2),receiver,index};}
    this.c.report(node,DiagnosticId.CS0131);return {kind:'local',type:'error',slot:this.temp()};
  }
  loadRef(ref){if(ref.kind==='framework'){this.loadFramework(ref);return;}if(ref.kind==='property'){const getter=this.propertyAccess(ref.property,ref.node,'get');if(getter){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.CALL,getter.id,ref.property.isStatic?0:1);}else this.emitConstant(null);}else if(ref.kind==='local'){if(!this.assigned.has(ref.slot))this.c.report(this.m.node,DiagnosticId.CS0165,[ref.name]);this.emit(Op.LDLOC,ref.slot);}else if(ref.kind==='static')this.emit(Op.LDSTATIC,ref.index);else{this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='field')this.emit(Op.LDFLD,ref.index);else{this.emit(Op.LDLOC,ref.index);this.emit(Op.LDELEM);}}}
  storeRef(ref){if(ref.kind==='framework'){this.storeFramework(ref);return;}if(ref.kind==='property'){const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);if(ref.property.set){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.LDLOC,value);this.emit(Op.CALL,ref.property.set.id,ref.property.isStatic?1:2);this.emit(Op.POP);}this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);}else if(ref.kind==='local'){this.emit(Op.STLOC,ref.slot);this.assigned.add(ref.slot);}else if(ref.kind==='static')this.emit(Op.STSTATIC,ref.index);else{const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='index')this.emit(Op.LDLOC,ref.index);this.emit(Op.LDLOC,value);this.emit(ref.kind==='field'?Op.STFLD:Op.STELEM,ref.kind==='field'?ref.index:0);this.clear(value);this.clear(ref.receiver);if(ref.kind==='index')this.clear(ref.index);}}
}
/** The complete method compiler: explicit class composition instead of prototype patching. */
export class MethodCompiler extends CallScopedInference(ModernCompiler(FrameworkCompiler(CoreMethodCompiler))) {}
