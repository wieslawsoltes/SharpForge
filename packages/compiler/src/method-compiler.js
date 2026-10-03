import {canonicalType,frameworkType,taskResult,findContracts} from '@sharpforge/framework';
import {Op,Binary,Unary,BuiltinMap,frameworkBuiltin} from '@sharpforge/bytecode';
import {evaluateConstant,ConstantError} from './constants.js';
import {normalize,numeric,isReference,assignable,defaultValue,alwaysReturns,pathOf,typeText,usingSpan} from './type-utils.js';
import {FrameworkCompiler} from './framework.js';
import {ModernCompiler} from './modern.js';
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
    if(this.scopes.some(s=>s.has(name)))this.c.report(node,'CS0136',[name]);
    const slot=this.locals.length,symbol=hidden?null:this.c.symbol({...node,name},'local',type,{method:this.m.qualifiedName,scopeStart:this.scopeNode?.start??this.m.node.start,scopeEnd:this.scopeNode?.end??this.m.node.end});
    const local={name,type,slot,symbol,hidden,scopeStartPc:this.pc,isConst:node.isConst??false,isUsing:node.isUsing??false,isIteration:node.isIteration??false,declaredAt:node.start,scopeEnd:this.scopeNode?.end??this.m.node.end};this.locals.push(local);this.scopes.at(-1).set(name,local);if(assigned)this.assigned.add(slot);return local;
  }
  closeScope(){const scope=this.scopes.pop();for(const l of scope.values())l.scopeEndPc=this.pc;return scope;}
  lookup(name){for(let i=this.scopes.length-1;i>=0;i--){const l=this.scopes[i].get(name);if(l)return l;}return null;}
  seq(node){if(node.debugHidden)return;const source=this.c.sources.get(node.uri);if(!source)return;const pos=source.positionAt(node.start),point={id:this.c.sequencePoints.length,methodId:this.m.id,offset:this.pc,uri:node.uri,start:node.start,end:node.end,line:pos.line+1,column:pos.character+1};this.c.sequencePoints.push(point);this.emit(Op.SEQ,point.id);}
  build(){this.stmt(this.m.node.body);if(this.m.returnType!=='void'&&!alwaysReturns(this.m.node.body))this.c.report(this.m.node,'CS0161',[this.m.qualifiedName]);this.emitConstant(defaultValue(this.m.returnType));this.emit(Op.RET);this.finish();}
  finish(){this.m.code=Int32Array.from(this.code);this.m.locals=this.locals.map(({symbol,...l})=>({...l,...(!l.hidden?{scopeEndPc:l.scopeEndPc??this.pc}:{})}));this.m.handlers=this.handlers;}
  checkAssign(target,from,node){if(!assignable(target,from))this.c.report(node,'CS0029',[typeText(from),typeText(target)]);}
  bool(node){const t=this.expr(node);this.checkAssign('bool',t,node);}
  stmt(node){if(!node)return;
    switch(node.kind){
      case 'Block':{const previous=this.scopeNode;this.scopeNode=node;this.scopes.push(new Map());this.statementList(node.statements);for(const local of this.scopes.at(-1).values())if(isReference(local.type))this.clear(local.slot);this.closeScope();this.scopeNode=previous;break;}
      case 'Empty':break;
      case 'Using':this.stmt(this.lowerUsing(node));break;
      case 'UsingDeclaration':this.c.report(node,'CS1023');break;
      case 'Local':this.seq(node);if(node.declarations.some(d=>d.isConst&&d.type==='var'))this.c.report(node,'CS0822');if(node.declarations.length>1&&node.declarations.some(d=>d.type==='var'))this.c.report(node,'CS0819');for(const d of node.declarations){let declared=this.c.resolveType(d.type,d,true,this.m),initType;
        if(d.initializer)initType=this.typedExpr(d.initializer,declared==='var'?null:declared);if(declared==='var'){if(!d.initializer||initType==='null'||initType==='void')this.c.report(d,'CS0818');declared=initType??'error';}
        if(declared==='void')this.c.report(d,'CS1547');
        const l=this.local(d.name,declared,d,false,!!d.hidden);if(d.initializer){this.checkAssign(declared,initType,d);this.emit(Op.STLOC,l.slot);this.emit(Op.POP);this.assigned.add(l.slot);}if(d.isConst&&!d.initializer)this.c.report(d,'CS0145');else if(d.isConst){const value=this.constant(d.initializer);if(!value)this.c.report(d,'CS0133',[d.name]);else l.constantValue={...value,type:declared};}}break;
      case 'ExpressionStatement':this.seq(node);this.expr(node.expression);this.emit(Op.POP);if(!['Call','Await','Assignment','New'].includes(node.expression.kind)&&!(node.expression.kind==='Unary'&&['++','--'].includes(node.expression.operator)))this.c.report(node,'CS0201');break;
      case 'If':{this.seq({...node,end:node.condition.end});this.bool(node.condition);const jump=this.emit(Op.JFALSE),before=new Set(this.assigned);this.stmt(node.then);const then=new Set(this.assigned),end=this.emit(Op.JUMP);this.patch(jump);this.assigned=new Set(before);this.stmt(node.otherwise);this.assigned=new Set([...then].filter(s=>this.assigned.has(s)));this.patch(end);break;}
      case 'While':case 'Do':case 'For':{
        this.scopes.push(new Map());if(node.init){if(node.init.kind==='Local')this.stmt(node.init);else{this.seq(node.init);this.expr(node.init);this.emit(Op.POP);}}
        const before=new Set(this.assigned),start=this.pc,loop={breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);let exit;
        if(node.kind!=='Do'){this.seq(node.condition??node);if(node.condition){this.bool(node.condition);exit=this.emit(Op.JFALSE);}}
        this.stmt(node.body);const continuePc=this.pc;for(const p of loop.continues)this.patch(p,continuePc);
        if(node.increment){this.seq(node.increment);this.expr(node.increment);this.emit(Op.POP);}
        if(node.kind==='Do'){this.seq(node.condition);this.bool(node.condition);this.emit(Op.JTRUE,start);}else this.emit(Op.JUMP,start);
        if(exit!==undefined)this.patch(exit);for(const p of loop.breaks)this.patch(p);this.loops.pop();this.closeScope();this.assigned=before;break;}
      case 'OverflowContext':{const previous=this.checkedContext;this.checkedContext=node.checked;try{this.stmt(node.body);}finally{this.checkedContext=previous;}break;}
      case 'Foreach':{
        const collectionType=this.infer(node.expression),getEnumerator=findContracts(collectionType,'GetEnumerator',false)[0];
        if(getEnumerator){const name='$enumerator'+this.locals.length,base={uri:node.uri,start:node.start,end:node.end},N=n=>({...base,kind:'Name',name:n}),M=(target,name)=>({...base,kind:'Member',target,name}),call=(target,name)=>({...base,kind:'Call',target:M(target,name),args:[]}),enumName=N(name),currentType=findContracts(getEnumerator.result,'get_Current',false)[0]?.result;
          const tree={...base,kind:'Block',statements:[{...base,kind:'Local',declarations:[{...base,name,type:getEnumerator.result,hidden:true,initializer:call(node.expression,'GetEnumerator')}]},{...base,kind:'Try',body:{...base,kind:'While',labels:node.labels,condition:call(enumName,'MoveNext'),body:{...base,kind:'Block',statements:[{...base,kind:'Local',declarations:[{...base,name:node.name,nameSpan:node.nameSpan,type:node.type==='var'?currentType:node.type,isIteration:true,initializer:M(enumName,'Current')}]},node.body]}},catches:[],finallyBody:{...base,kind:'Block',statements:[{...base,kind:'ExpressionStatement',expression:call(enumName,'Dispose')}]}}]};this.stmt(tree);break;}
        this.scopes.push(new Map());this.seq({...node,end:node.expression.end});const arrayType=this.expr(node.expression);if(!arrayType.endsWith('[]'))this.c.report(node,'CS1579',[typeText(arrayType),'GetEnumerator']);const element=arrayType.endsWith('[]')?arrayType.slice(0,-2):'error',arr=this.temp(arrayType),index=this.temp('int');this.emit(Op.STLOC,arr);this.emit(Op.POP);this.emitConstant(0);this.emit(Op.STLOC,index);this.emit(Op.POP);
        const l=this.local(node.name,node.type==='var'?element:this.c.resolveType(node.type,node,false,this.m),{...node,isIteration:true},true);this.checkAssign(l.type,element,node);const start=this.pc;this.seq({...node,end:node.expression.end});this.emit(Op.LDLOC,index);this.emit(Op.LDLOC,arr);this.emit(Op.LENGTH);this.emit(Op.BINARY,Binary['<']);const exit=this.emit(Op.JFALSE);this.emit(Op.LDLOC,arr);this.emit(Op.LDLOC,index);this.emit(Op.LDELEM);this.emit(Op.STLOC,l.slot);this.emit(Op.POP);
        const loop={breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.stmt(node.body);for(const p of loop.continues)this.patch(p);this.emit(Op.LDLOC,index);this.emitConstant(1);this.emit(Op.BINARY,Binary['+'],1);this.emit(Op.STLOC,index);this.emit(Op.POP);this.emit(Op.JUMP,start);this.patch(exit);for(const p of loop.breaks)this.patch(p);this.loops.pop();this.clear(arr);for(const local of this.scopes.at(-1).values())if(isReference(local.type))this.clear(local.slot);this.closeScope();break;}
      case 'Break':case 'Continue':{this.seq(node);if(node.label)this.c.requireFeature(node,15,'Labeled break and continue');const loop=node.label?[...this.loops].reverse().find(l=>l.labels?.includes(node.label)&&(node.kind!=='Continue'||!l.switch)):node.kind==='Continue'?[...this.loops].reverse().find(l=>!l.switch):this.loops.at(-1);if(loop&&this.finallyScopes.length&&!this.loops.slice(this.finallyScopes.at(-1)).includes(loop))this.c.report(node,'CS0157');if(!loop)this.c.report(node,'CS0139');else loop[node.kind==='Break'?'breaks':'continues'].push(this.emit(Op.JUMP));break;}
      case 'Switch':this.switchStatement(node);break;
      case 'Return':if(this.finallyScopes.length)this.c.report(node,'CS0157');this.seq(node);if(node.expression){const type=this.typedExpr(node.expression,this.m.returnType);this.checkAssign(this.m.returnType,type,node);}else{if(this.m.returnType!=='void')this.c.report(node,'CS0126',[typeText(this.m.returnType)]);this.emitConstant(null);}this.emit(Op.RET);break;
      case 'Throw':this.seq(node);if(node.expression){const type=this.expr(node.expression);if(type!=='Exception'&&type!=='null'&&type!=='error')this.c.report(node,'CS0155');this.emit(Op.THROW);}else{if(!this.catchDepth)this.c.report(node,'CS0156');this.emit(Op.RETHROW);}break;
      case 'Try':{
        if(node.finallyBody){
          const start=this.pc,before=new Set(this.assigned);
          if(node.catches.length)this.stmt({...node,finallyBody:null});else this.stmt(node.body);
          if(this.pc===start)this.emit(Op.NOP);const normalAssigned=new Set(this.assigned),end=this.pc,jump=this.emit(Op.JUMP),handler={kind:'finally',start,end,target:this.pc,handlerEnd:0};this.handlers.push(handler);
          this.assigned=new Set(before);this.finallyScopes.push(this.loops.length);this.stmt(node.finallyBody);this.finallyScopes.pop();this.emit(Op.ENDFINALLY);handler.handlerEnd=this.pc;this.patch(jump);for(const slot of normalAssigned)this.assigned.add(slot);break;
        }
        const start=this.pc,before=new Set(this.assigned);this.stmt(node.body);if(this.pc===start)this.emit(Op.NOP);const end=this.pc,jumps=[this.emit(Op.JUMP)];
        for(const ca of node.catches){this.scopes.push(new Map());this.assigned=new Set(before);const type=this.c.resolveType(ca.type,node,false,this.m);if(type!=='Exception')this.c.report(node,'SF2002');const slot=this.temp('Exception');if(ca.name){const l=this.local(ca.name,'Exception',{...ca.body,name:ca.name,nameSpan:ca.nameSpan},true);l.scopeEnd=ca.body.end;this.locals[slot].hidden=true;this.handlers.push({start,end,target:this.pc,slot:l.slot,type});}else this.handlers.push({start,end,target:this.pc,slot,type});this.catchDepth++;this.stmt(ca.body);this.catchDepth--;jumps.push(this.emit(Op.JUMP));this.closeScope();}
        for(const jump of jumps)this.patch(jump);this.assigned=before;break;}
      default:this.c.report(node,'SF2099',[node.kind]);
    }
  }
  statementList(statements){
    for(let i=0;i<statements.length;i++){const s=statements[i];if(s.kind==='UsingDeclaration'){this.stmt({...s,kind:'Using',body:{...s,kind:'Block',end:statements.at(-1)?.end??s.end,statements:statements.slice(i+1)}});return;}this.stmt(s);}
  }
  lowerUsing(node){
    if(node.resources.kind==='Local'&&node.resources.declarations.length>1&&node.resources.declarations.some(d=>d.type==='var'))this.c.report(node,'CS0819');
    const declarations=node.resources.kind==='Local'?node.resources.declarations:[{...node.resources,kind:'Variable',name:`$using${this.locals.length}_${this.pc}`,type:'var',initializer:node.resources,hidden:true}];
    const lower=index=>{
      if(index>=declarations.length)return node.body;
      const d=declarations[index],type=d.type==='var'?this.infer(d.initializer):this.c.typeName(d.type,this.m),owner=this.c.findType(type,this.m);
      if(!d.initializer)this.c.report(d,'CS0210');
      if(!owner?.interfaces.includes('System.IDisposable')&&!(['network','bcl','bcl14'].includes(frameworkType(type)?.kind)&&findContracts(type,'Dispose',false).some(c=>!c.parameters.length)))this.c.report(usingSpan(node,d),'CS1674',[typeText(type)]);
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
    this.c.report(node??this.m.node,'CS0150');return {value:null,type:'error'};
  }
  switchDispatch(node,groups){
    this.seq({...node,end:node.expression.end});const type=this.expr(node.expression),slot=this.temp(type);if(!['int','string','bool'].includes(type))this.c.report(node,'CS0151');this.emit(Op.STLOC,slot);this.emit(Op.POP);
    const branches=groups.map(()=>[]),seen=new Set();let fallback=-1;
    groups.forEach((labels,index)=>labels.forEach(label=>{if(label===null){if(fallback>=0)this.c.report(node,'CS0152',['default']);fallback=index;return;}const constant=this.constantPattern(label),key=JSON.stringify([constant.type,constant.value]);if(seen.has(key))this.c.report(label,'CS0152',[String(constant.value)]);seen.add(key);this.checkAssign(type,constant.type,label);this.emit(Op.LDLOC,slot);this.emitConstant(constant.value,constant.type);this.emit(Op.BINARY,Binary['==']);branches[index].push(this.emit(Op.JTRUE));}));
    return {branches,fallback,otherwise:this.emit(Op.JUMP),slot};
  }
  switchStatement(node){
    const before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.sections.map(s=>s.labels)),loop={switch:true,breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.scopes.push(new Map());
    const ends=[];node.sections.forEach((section,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);for(const s of section.statements)this.stmt(s);const terminal=s=>alwaysReturns(s)||['Break','Continue'].includes(s?.kind)||s?.kind==='Block'&&terminal(s.statements.at(-1))||s?.kind==='If'&&terminal(s.then)&&terminal(s.otherwise);if(section.statements.length&&!terminal(section.statements.at(-1)))this.c.report(section,'CS0163',[this.c.caseLabel(section)]);ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0)this.patch(dispatch.otherwise);for(const p of [...ends,...loop.breaks])this.patch(p);this.loops.pop();for(const local of this.scopes.at(-1).values())this.clear(local.slot);this.closeScope();this.clear(dispatch.slot);this.assigned=before;
  }
  switchType(node){const types=node.arms.map(a=>this.infer(a.expression));return types.includes('double')&&types.every(t=>numeric(t))?'double':types.find(t=>t!=='null')??'error';}
  switchExpression(node){
    const type=this.switchType(node),before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.arms.map(a=>[a.pattern])),ends=[],assigned=[];
    node.arms.forEach((arm,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);this.checkAssign(type,this.expr(arm.expression),arm);assigned.push(new Set(this.assigned));ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0){this.patch(dispatch.otherwise);this.emitConstant('No switch expression arm matched.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);this.emit(Op.THROW);this.c.report(node,'CS8509',['_']);}
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
    if(!method){this.c.report(node,kind==='get'?'CS0154':'CS0200',[property.name]);return null;}
    if(['private','protected'].includes(method.accessor.access)&&this.m.owner!==property.owner)this.c.report(node,kind==='get'?'CS0271':'CS0272',[property.name]);
    if(!property.isStatic&&node.kind==='Name'&&!this.lookup('this'))this.c.report(node,'CS0120',[property.name]);
    return method;
  }
  propertyReceiver(property,node){if(!property.isStatic){if(node.kind==='Member')this.expr(node.target);else this.emit(Op.LDLOC,this.lookup('this')?.slot??0);}}
  readProperty(property,node){const getter=this.propertyAccess(property,node,'get');if(getter){this.propertyReceiver(property,node);this.emit(Op.CALL,getter.id,property.isStatic?0:1);}else this.emitConstant(null);return property.type;}
  field(node){
    if(node.kind==='Name')return this.m.owner?.fields.find(f=>f.name===node.name)??null;
    const path=pathOf(node.target),owner=this.c.findType(path,this.m);if(owner)return owner.fields.find(f=>f.name===node.name&&f.isStatic)??null;
    const type=this.infer(node.target);return this.c.findType(type,this.m)?.fields.find(f=>f.name===node.name&&!f.isStatic)??null;
  }
  isNameof(node){return node?.kind==='Call'&&node.target.kind==='Name'&&node.target.name==='nameof'&&!this.c.methods.some(m=>m.name==='nameof'&&(m.owner===this.m.owner||!m.owner));}
  nameof(node,bind=true){
    const argument=node.args[0];if(node.args.length!==1||!argument||!['Name','Member'].includes(argument.kind)){if(bind)this.c.report(node,'CS8081');return '';}
    // The restricted profile supports identifier/member chains, not arbitrary receiver expressions.
    const path=pathOf(argument);if(!path||path.includes('null.')){if(bind)this.c.report(argument,'CS8081');return '';}
    let symbol=null,valid=false;
    if(argument.kind==='Name'){
      const local=this.lookup(argument.name),field=this.m.owner?.fields.find(f=>f.name===argument.name)??this.m.owner?.properties.find(p=>p.name===argument.name),type=this.c.findType(argument.name,this.m),methods=this.c.methods.filter(m=>m.name===argument.name&&(m.owner===this.m.owner||!m.owner));
      symbol=local?.symbol??field?.symbol??type?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!local||!!field||!!type||methods.length>0||['System','Console','Math','GC','Array','Convert','Debug','Exception'].includes(argument.name);
    }else{
      const receiver=pathOf(argument.target),local=argument.target.kind==='Name'?this.lookup(receiver):null,type=this.c.findType(receiver??'',this.m)??this.c.findType(this.infer(argument.target),this.m),field=type?.fields.find(f=>f.name===argument.name)??type?.properties.find(p=>p.name===argument.name),methods=type?.methods.filter(m=>m.name===argument.name)??[];
      symbol=field?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!field||methods.length>0||BuiltinMap.has(path.replace(/^System\./,''))||path==='System.Console'||path==='System.Math'||path==='System.GC'||path==='System.Exception'||path==='System.String'||path==='System.Int32'||argument.name==='Length'&&(local?.type==='string'||local?.type?.endsWith('[]'));
      if(bind&&local?.symbol)this.c.reference(argument.target,local.symbol);
    }
    if(!valid&&bind)this.c.report(argument,'CS0103',[path]);
    if(bind&&symbol)this.c.reference(argument,symbol);return argument.name;
  }
  infer(node){
    if(!node)return 'error';const external=this.frameworkInfer(node);if(external!==undefined)return external;switch(node.kind){
      case 'Await':return taskResult(this.infer(node.expression))??'error';case 'Checked':case 'Unchecked':return this.infer(node.expression);case 'Cast':case 'Default':return this.c.typeName(node.type,this.m);case 'SwitchExpression':return this.switchType(node);
      case 'InterpolatedString':return 'string';case 'Literal':return node.type;case 'Name':return this.lookup(node.name)?.type??this.property(node)?.type??this.m.owner?.fields.find(f=>f.name===node.name)?.type??'error';
      case 'New':return this.c.typeName(node.type,this.m);case 'NewArray':return node.type==='var[]'?(node.values?.length?this.infer(node.values[0])+'[]':'error[]'):node.type;
      case 'Index':{const t=this.infer(node.target);return t.endsWith('[]')?t.slice(0,-2):'error';}
      case 'Member':if(node.name==='Length')return 'int';if(node.name==='Message'&&this.infer(node.target)==='Exception')return 'string';return this.property(node)?.type??this.field(node)?.type??'error';
      case 'Call':{if(this.isNameof(node))return 'string';const builtin=this.findBuiltin(node);if(builtin)return builtin.result==='numeric'?node.args.some(a=>this.infer(a)==='double')?'double':'int':builtin.result;return this.findMethod(node,false)?.returnType??'error';}
      case 'Assignment':return this.infer(node.left);case 'Conditional':return this.infer(node.whenTrue);case 'Unary':return node.operator==='!'?'bool':this.infer(node.operand);
      case 'Binary':if(['==','!=','<','>','<=','>=','&&','||'].includes(node.operator))return 'bool';{const l=this.infer(node.left),r=this.infer(node.right);if(node.operator==='+'&&(l==='string'||r==='string'))return 'string';return l==='double'||r==='double'?'double':l;}
      default:return 'error';
    }
  }
  findBuiltin(node){
    let name=pathOf(node.target);if(name?.startsWith('System.'))name=name.slice(7);if(BuiltinMap.has(name))return BuiltinMap.get(name);
    if(node.target.kind==='Member'){const receiver=this.infer(node.target.target);if(receiver==='string'&&BuiltinMap.has('string.'+node.target.name))return BuiltinMap.get('string.'+node.target.name);if(node.target.name==='ToString')return BuiltinMap.get('object.ToString');}return null;
  }
  findMethod(node,report=true){
    let candidates=[];const target=node.target;
    if(target.kind==='Name')candidates=this.c.methods.filter(m=>m.name===target.name&&(m.owner===this.m.owner||!m.owner)&&(!this.m.isStatic||m.isStatic));
    else if(target.kind==='Member'){const path=pathOf(target.target),type=this.c.findType(path,this.m);if(type)candidates=type.methods.filter(m=>m.name===target.name&&m.isStatic);else{const type=this.c.findType(this.infer(target.target),this.m);candidates=type?.methods.filter(m=>m.name===target.name&&!m.isStatic)??[];}}
    if(candidates.some(m=>m.accessor)){if(report)this.c.report(node,'CS0571',[pathOf(target)??target.name]);candidates=candidates.filter(m=>!m.accessor);}
    const types=node.args.map(a=>this.infer(a));candidates=candidates.filter(m=>m.parameters.length===types.length&&m.parameters.every((p,i)=>assignable(p.type,types[i])));
    candidates.sort((a,b)=>a.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)-b.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0));
    if(!candidates.length&&report)this.c.report(node,'CS1501',[target.name??'<expression>',node.args.length]);
    if(candidates.length>1&&candidates[0].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)===candidates[1].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)&&report)this.c.report(node,'CS0121',[candidates[0].qualifiedName,candidates[1].qualifiedName]);
    return candidates[0]??null;
  }
  overflowChecked(node){return this.checkedContext??this.c.options.checkOverflowByUri?.[node?.uri??this.m.node.uri]??this.c.options.checkOverflow??false;}
  constant(node){try{return evaluateConstant(node,{checked:this.checkedContext!==false,resolve:n=>n.kind==='Name'?this.lookup(n.name)?.constantValue??null:null});}catch(error){if(!(error instanceof ConstantError))throw error;const key=error.node.start+':'+error.code;if(!this.constantDiagnostics.has(key)){this.constantDiagnostics.add(key);this.c.report(error.node,error.code,error.args);}return null;}}
  expr(node){
    if(!node){this.emitConstant(null);return 'error';}const external=this.frameworkExpression(node);if(external!==undefined)return external;
    if(['Binary','Unary','Cast'].includes(node.kind))this.constant(node);
    switch(node.kind){
      case 'InterpolatedString':{
        this.emitConstant('');const format=findContracts('SharpForge.Runtime.Formatting','FormatValue',true)[0];
        for(const part of node.parts){if(part.text!==undefined)this.emitConstant(part.text);else{const type=this.expr(part.expression);if(type==='void')this.c.report(part.expression,'CS0029',['void','object']);this.emitConstant(part.format);this.emitConstant(part.alignment);this.emitConstant(type);this.emitContract(format);}this.emit(Op.BINARY,Binary['+'],2);}return 'string';
      }
      case 'Await':{if(!this.m.node.asyncBody&&!this.m.name.startsWith('<startup>'))this.c.report(node,'CS4032',[typeText(this.m.returnType)]);const type=this.expr(node.expression),d=findContracts('SharpForge.Runtime.Async','Await',true).find(x=>x.parameters[0]===type);if(!d){this.c.report(node,'CS1061',[typeText(type),'GetAwaiter']);return 'error';}const builtin=frameworkBuiltin(d);this.emit(Op.BUILTIN,builtin.id,1);return d.result;}
      case 'Default':{const type=this.c.resolveType(node.type,node,false,this.m);if(type==='void')this.c.report(node,'CS1547');this.emitConstant(defaultValue(type),type);return type;}
      case 'Checked':case 'Unchecked':{const previous=this.checkedContext;this.checkedContext=node.kind==='Checked';try{return this.expr(node.expression);}finally{this.checkedContext=previous;}}
      case 'Cast':{const from=this.expr(node.expression),to=this.c.resolveType(node.type,node,false,this.m);if(!numeric(from)||!numeric(to))this.c.report(node,'CS0030',[typeText(from),typeText(to)]);this.emit(Op.CONVERT,to==='int'?0:1,this.overflowChecked(node)&&to==='int'?1:0);return to;}
      case 'SwitchExpression':return this.switchExpression(node);
      case 'Error':this.emitConstant(null);return 'error';
      case 'Literal':if(node.type==='char')this.c.report(node,'SF2003');if(node.type==='int'&&node.value>2147483647&&!this.c.reportedAt(node,'SF1004'))this.c.report(node,'SF2004');this.emitConstant(node.value,node.type);return node.type;
      case 'Name':{
        const l=this.lookup(node.name);if(l){if(!this.assigned.has(l.slot))this.c.report(node,'CS0165',[l.name]);if(l.symbol)this.c.reference(node,l.symbol);this.emit(Op.LDLOC,l.slot);return l.type;}
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);if(f.isStatic)this.emit(Op.LDSTATIC,f.index);else{const self=this.lookup('this');if(!self)this.c.report(node,'CS0120',[node.name]);this.emit(Op.LDLOC,self?.slot??0);this.emit(Op.LDFLD,f.index);}return f.type;}
        this.c.report(node,'CS0103',[node.name]);this.emitConstant(null);return 'error';}
      case 'Member':{
        const type=this.infer(node.target);
        if(node.name==='Length'&&(type==='string'||type.endsWith('[]'))){this.expr(node.target);this.emit(Op.LENGTH);return 'int';}
        if(node.name==='Message'&&type==='Exception'){this.expr(node.target);this.emit(Op.BUILTIN,BuiltinMap.get('Exception.Message').id,1);return 'string';}
        if(pathOf(node)==='Environment.TickCount'||pathOf(node)==='System.Environment.TickCount'){this.emit(Op.BUILTIN,BuiltinMap.get('Environment.TickCount').id,0);return 'int';}
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);if(f.isStatic)this.emit(Op.LDSTATIC,f.index);else{this.expr(node.target);this.emit(Op.LDFLD,f.index);}return f.type;}
        this.c.report(node,'CS1061',[typeText(type),node.name]);this.emitConstant(null);return 'error';}
      case 'Index':{const type=this.expr(node.target);const index=this.expr(node.index);this.checkAssign('int',index,node.index);if(!type.endsWith('[]'))this.c.report(node,'SF2005',[typeText(type)]);this.emit(Op.LDELEM);return type.endsWith('[]')?type.slice(0,-2):'error';}
      case 'Binary':{
        if(['&&','||','??'].includes(node.operator)){
          const lt=this.expr(node.left);this.emit(Op.DUP);let jump;
          if(node.operator==='??'){if(!isReference(lt)&&lt!=='null'&&lt!=='error')this.c.report(node,'CS0019',['??',typeText(lt),typeText(this.infer(node.right))]);this.emitConstant(null);this.emit(Op.BINARY,Binary['!=']);jump=this.emit(Op.JTRUE);}else{this.checkAssign('bool',lt,node.left);jump=this.emit(node.operator==='&&'?Op.JFALSE:Op.JTRUE);}
          this.emit(Op.POP);const beforeRight=new Set(this.assigned);const rt=this.expr(node.right);this.assigned=beforeRight;if(node.operator!=='??')this.checkAssign('bool',rt,node.right);else if(lt!=='null')this.checkAssign(lt,rt,node);this.patch(jump);return node.operator==='??'?(lt==='null'?rt:lt):'bool';
        }
        const left=this.expr(node.left),right=this.expr(node.right);return this.binary(node.operator,left,right,node);}
      case 'Unary':{
        if(['++','--'].includes(node.operator)){
          const ref=this.prepare(node.operand);this.loadRef(ref);const previous=node.postfix?this.temp(ref.type):null;if(previous!==null){this.emit(Op.STLOC,previous);}this.emitConstant(1);this.binary(node.operator==='++'?'+':'-',ref.type,'int',node);this.storeRef(ref);if(previous!==null){this.emit(Op.POP);this.emit(Op.LDLOC,previous);}return ref.type;
        }
        if(node.operator==='-'&&node.operand.kind==='Literal'&&node.operand.type==='int'&&node.operand.value===2147483648){this.emitConstant(-2147483648);return 'int';}
        const type=this.expr(node.operand);if(node.operator==='!')this.checkAssign('bool',type,node);else if(!numeric(type))this.c.report(node,'CS0023',[node.operator,typeText(type)]);if(node.operator==='~')this.checkAssign('int',type,node);this.emit(Op.UNARY,Unary[node.operator],type==='int'?(this.overflowChecked(node)&&node.operator==='-'?5:1):0);return node.operator==='!'?'bool':type;}
      case 'Assignment':{const ref=this.prepare(node.left,node.operator==='=');if(node.operator==='??='){if(!isReference(ref.type))this.c.report(node,'CS0019',['??=',typeText(ref.type),typeText(this.infer(node.right))]);this.loadRef(ref);this.emit(Op.DUP);this.emitConstant(null);this.emit(Op.BINARY,Binary['==']);const done=this.emit(Op.JFALSE);this.emit(Op.POP);this.checkAssign(ref.type,this.typedExpr(node.right,ref.type),node);this.storeRef(ref);this.patch(done);return ref.type;}if(node.operator==='='){const type=this.typedExpr(node.right,ref.type);this.checkAssign(ref.type,type,node);}else{this.loadRef(ref);const type=this.expr(node.right);const result=this.binary(node.operator.slice(0,-1),ref.type,type,node);this.checkAssign(ref.type,result,node);}this.storeRef(ref);return ref.type;}
      case 'Conditional':{this.bool(node.condition);const before=new Set(this.assigned),no=this.emit(Op.JFALSE),yesType=this.expr(node.whenTrue),yesAssigned=new Set(this.assigned),done=this.emit(Op.JUMP);this.patch(no);this.assigned=new Set(before);const noType=this.expr(node.whenFalse);this.assigned=new Set([...yesAssigned].filter(s=>this.assigned.has(s)));this.patch(done);if(!assignable(yesType,noType)&&!assignable(noType,yesType))this.c.report(node,'CS0173',[typeText(yesType),typeText(noType)]);return yesType==='null'?noType:yesType==='double'||noType==='double'?'double':yesType;}
      case 'Call':{
        if(this.isNameof(node)){this.emitConstant(this.nameof(node));return 'string';}
        const builtin=this.findBuiltin(node);if(builtin){let count=0,types=[];const staticPath=pathOf(node.target)?.replace(/^System\./,'');if(staticPath!==builtin.name&&node.target.kind==='Member'){types.push(this.expr(node.target.target));count++;}
          for(const a of node.args){types.push(this.expr(a));count++;}if(count<builtin.min||count>builtin.max)this.c.report(node,'CS1501',[builtin.name,count]);
          types.forEach((type,i)=>{const target=builtin.params[i];if(target==='number'){if(!numeric(type))this.c.report(node,'CS1503',[i+1,typeText(type),'double']);}else if(target==='array'){if(!type.endsWith('[]'))this.c.report(node,'CS1503',[i+1,typeText(type),'System.Array']);}else if(target&&target!=='any'&&target!=='exception')this.checkAssign(target,type,node.args[Math.max(0,i-(count-node.args.length))]??node);});
          this.emit(Op.BUILTIN,builtin.name==='Math.Abs'&&types[0]==='int'?BuiltinMap.get('$Math.Abs.Int32').id:builtin.id,count);return builtin.result==='numeric'?(types.includes('double')?'double':'int'):builtin.result;
        }
        const method=this.findMethod(node);let count=node.args.length;if(method&&!method.isStatic){if(node.target.kind==='Member')this.expr(node.target.target);else this.emit(Op.LDLOC,this.lookup('this')?.slot??0);count++;}
        node.args.forEach((arg,i)=>{const type=this.typedExpr(arg,method?.parameters[i]?.type);if(method)this.checkAssign(method.parameters[i]?.type??'error',type,arg);});
        if(method){if(method.symbol){this.c.reference(node.target,method.symbol);const reference=this.c.references.at(-1);reference.call=true;reference.callerId=this.m.symbol?.id??null;}this.emit(Op.CALL,method.id,count);return method.returnType;}
        for(let i=0;i<count;i++)this.emit(Op.POP);this.emitConstant(null);return 'error';}
      case 'NewArray':{
        let type=node.type;if(type==='var[]'){if(!node.values?.length)this.c.report(node,'CS0826');type=(node.values?.length?this.infer(node.values[0]):'error')+'[]';}
        type=this.c.resolveType(type,node,false,this.m);const element=type.slice(0,-2);
        if(node.length)this.checkAssign('int',this.expr(node.length),node.length);else this.emitConstant(node.values?.length??0);
        this.emit(Op.NEWARR,this.c.constant(element));
        if(node.values)node.values.forEach((value,i)=>{this.emit(Op.DUP);this.emitConstant(i);this.checkAssign(element,this.typedExpr(value,element),value);this.emit(Op.STELEM);this.emit(Op.POP);});return type;}
      case 'New':{if(node.collectionInitializers?.length)this.c.report(node,'SF2013');
        const name=this.c.typeName(node.type,this.m);if(name==='Exception'){if(node.args.length>1)this.c.report(node,'CS1501',['Exception',node.args.length]);if(node.args.length)this.checkAssign('string',this.expr(node.args[0]),node.args[0]);else this.emitConstant('An exception was thrown.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);return 'Exception';}
        const type=this.c.findType(name,this.m);if(!type){this.c.report(node,'CS0246',[typeText(name)]);this.emitConstant(null);return 'error';}
        this.emit(Op.NEWOBJ,type.id);const slot=this.temp(name);this.emit(Op.STLOC,slot);this.emit(Op.POP);
        if(type.initializer!==undefined){this.emit(Op.LDLOC,slot);this.emit(Op.CALL,type.initializer,1);this.emit(Op.POP);}
        const ctors=type.methods.filter(m=>m.name==='.ctor'),ctor=ctors.find(m=>m.parameters.length===node.args.length&&m.parameters.every((p,i)=>assignable(p.type,this.infer(node.args[i]))));
        if(ctor){this.emit(Op.LDLOC,slot);for(let i=0;i<node.args.length;i++)this.typedExpr(node.args[i],ctor.parameters[i].type);this.emit(Op.CALL,ctor.id,node.args.length+1);this.emit(Op.POP);}else if(node.args.length||ctors.length)this.c.report(node,'CS1729',[name,node.args.length]);
        for(const init of node.initializers){const property=type.properties.find(p=>p.name===init.name&&!p.isStatic),field=type.fields.find(f=>f.name===init.name&&!f.isStatic);if(!property&&!field){this.c.report(init,'CS0117',[name,init.name]);continue;}
          if(property){const setter=this.propertyAccess(property,{...init,kind:'Member'},'set');if(setter){this.emit(Op.LDLOC,slot);this.checkAssign(property.type,this.typedExpr(init.expression,property.type),init);this.emit(Op.CALL,setter.id,2);this.emit(Op.POP);}}
          else {this.c.reference(init,field.symbol);this.emit(Op.LDLOC,slot);this.checkAssign(field.type,this.typedExpr(init.expression,field.type),init);this.emit(Op.STFLD,field.index);this.emit(Op.POP);}}
        this.emit(Op.LDLOC,slot);this.clear(slot);return name;}
      default:this.c.report(node,'SF2098',[node.kind]);this.emitConstant(null);return 'error';
    }
  }
  binary(operator,left,right,node){
    if(frameworkType(left)?.family==='vector'&&left===right){const name={'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','&':'BitwiseAnd','^':'Xor','==':'EqualsAll','!=':'EqualsAll'}[operator],contract=name&&findContracts('System.Numerics.Vector',name,true).find(d=>d.parameters[0]===left);if(contract){this.emitContract(contract);if(operator==='!=')this.emit(Op.UNARY,Unary['!']);return contract.result;}}
    let result;
    if(operator==='+'&&(left==='string'||right==='string'))result='string';
    else if(['==','!='].includes(operator)){if(!assignable(left,right)&&!assignable(right,left))this.c.report(node,'CS0019',[operator,typeText(left),typeText(right)]);result='bool';}
    else if(['&','|','^'].includes(operator)&&left==='bool'&&right==='bool')result='bool';
    else {if(!numeric(left)||!numeric(right))this.c.report(node,'CS0019',[operator,typeText(left),typeText(right)]);if(['&','|','^','<<','>>'].includes(operator)&&(left!=='int'||right!=='int'))this.c.report(node,'CS0019',[operator,typeText(left),typeText(right)]);result=['<','<=','>','>='].includes(operator)?'bool':left==='double'||right==='double'?'double':'int';}
    if(!(operator in Binary)){this.c.report(node,'SF2006',[operator]);this.emit(Op.POP);return 'error';}
    this.emit(Op.BINARY,Binary[operator],result==='int'?(this.overflowChecked(node)&&['+','-','*'].includes(operator)?5:1):result==='string'?2:result==='bool'&&left==='bool'?3:0);return result;
  }
  prepare(node,allowReadOnly=false){const framework=this.prepareFramework(node);if(framework)return framework;
    if(node.kind==='Name'){const l=this.lookup(node.name);if(l){if(l.isConst)this.c.report(node,'CS0131');if(l.isUsing)this.c.report(node,'CS1656',[node.name,'using variable']);if(l.isIteration)this.c.report(node,'CS1656',[node.name,'foreach iteration variable']);if(l.symbol)this.c.reference(node,l.symbol);return {kind:'local',...l};}}
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
    if(f){this.c.reference(node,f.symbol);if(f.isStatic)return {kind:'static',type:f.type,index:f.index};if(node.kind==='Member')this.expr(node.target);else{const self=this.lookup('this');if(!self)this.c.report(node,'CS0120',[node.name]);this.emit(Op.LDLOC,self?.slot??0);}const receiver=this.temp(f.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);return {kind:'field',type:f.type,index:f.index,receiver};}
    if(node.kind==='Index'){const type=this.expr(node.target),receiver=this.temp(type);this.emit(Op.STLOC,receiver);this.emit(Op.POP);this.checkAssign('int',this.expr(node.index),node.index);const index=this.temp('int');this.emit(Op.STLOC,index);this.emit(Op.POP);if(!type.endsWith('[]'))this.c.report(node,'CS0021',[typeText(type)]);return {kind:'index',type:type.slice(0,-2),receiver,index};}
    this.c.report(node,'CS0131');return {kind:'local',type:'error',slot:this.temp()};
  }
  loadRef(ref){if(ref.kind==='framework'){this.loadFramework(ref);return;}if(ref.kind==='property'){const getter=this.propertyAccess(ref.property,ref.node,'get');if(getter){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.CALL,getter.id,ref.property.isStatic?0:1);}else this.emitConstant(null);}else if(ref.kind==='local'){if(!this.assigned.has(ref.slot))this.c.report(this.m.node,'CS0165',[ref.name]);this.emit(Op.LDLOC,ref.slot);}else if(ref.kind==='static')this.emit(Op.LDSTATIC,ref.index);else{this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='field')this.emit(Op.LDFLD,ref.index);else{this.emit(Op.LDLOC,ref.index);this.emit(Op.LDELEM);}}}
  storeRef(ref){if(ref.kind==='framework'){this.storeFramework(ref);return;}if(ref.kind==='property'){const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);if(ref.property.set){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.LDLOC,value);this.emit(Op.CALL,ref.property.set.id,ref.property.isStatic?1:2);this.emit(Op.POP);}this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);}else if(ref.kind==='local'){this.emit(Op.STLOC,ref.slot);this.assigned.add(ref.slot);}else if(ref.kind==='static')this.emit(Op.STSTATIC,ref.index);else{const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='index')this.emit(Op.LDLOC,ref.index);this.emit(Op.LDLOC,value);this.emit(ref.kind==='field'?Op.STFLD:Op.STELEM,ref.kind==='field'?ref.index:0);this.clear(value);this.clear(ref.receiver);if(ref.kind==='index')this.clear(ref.index);}}
}
/** The complete method compiler: explicit class composition instead of prototype patching. */
export class MethodCompiler extends ModernCompiler(FrameworkCompiler(CoreMethodCompiler)) {}
