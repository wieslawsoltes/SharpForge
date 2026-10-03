import {installModernCompiler,languageVersion,hasBackingField,rewriteBackingField} from './modern.js';
import {lowerAsyncFiles} from './async-lowering.js';
import {canonicalType,frameworkType,frameworkAssignable,taskResult,findContracts} from '@sharpforge/framework';
import {installFrameworkCompiler} from './framework.js';
import {emitPortablePdb,attachPortablePdb,SymbolError} from '@sharpforge/symbols';
import {evaluateConstant,ConstantError} from './constants.js';
export {evaluateConstant,ConstantError} from './constants.js';
import { emitAssemblyDetailed, CilError } from '@sharpforge/cil';
import { SourceText, diagnostic } from '@sharpforge/text';
import { parse } from '@sharpforge/syntax';
import { Op, Binary, Unary, BuiltinMap, frameworkBuiltin, FORMAT_VERSION } from '@sharpforge/bytecode';
const supported = new Set(['int','double','bool','string','object','void','var','null','error','Exception']);
const aliases = { 'System.Int32':'int','System.Double':'double','System.Boolean':'bool','System.String':'string','System.Object':'object','System.Void':'void','System.Exception':'Exception' };
const normalize = t=>canonicalType(aliases[t]??t);
const numeric = t=>t==='int'||t==='double';
const isReference = t=>t==='string'||t==='object'||t==='Exception'||(!supported.has(t)&&t!=='error')||t.endsWith('[]');
export function assignable(target,from) { return frameworkAssignable(target,from)||target==='error'||from==='error'||target===from||target==='object'&&from!=='void'||target==='double'&&from==='int'||from==='null'&&isReference(target); }
function defaultValue(type){return numeric(type)?0:type==='bool'?false:null;}
function alwaysReturns(s){return (s?.kind==='Using'||s?.kind==='OverflowContext')&&alwaysReturns(s.body)||s?.kind==='Switch'&&s.sections.some(x=>x.labels.includes(null))&&s.sections.every(x=>x.statements.some(alwaysReturns))||s?.kind==='Return'||s?.kind==='Throw'||s?.kind==='Block'&&s.statements.some(alwaysReturns)||s?.kind==='If'&&alwaysReturns(s.then)&&alwaysReturns(s.otherwise)||s?.kind==='Try'&&(alwaysReturns(s.finallyBody)||alwaysReturns(s.body)&&s.catches.every(c=>alwaysReturns(c.body)));}
function pathOf(e){return e.kind==='Name'?e.name:e.kind==='Member'?`${pathOf(e.target)}.${e.name}`:null;}
export class Compilation {
  constructor(parsedFiles, options={}) {
    parsedFiles=lowerAsyncFiles(parsedFiles);this.files=parsedFiles;this.options=options;this.sources=new Map(parsedFiles.map(p=>[p.source.uri,p.source]));
    this.diagnostics=parsedFiles.flatMap(p=>p.diagnostics);this.symbols=[];this.references=[];this.types=[];this.typeMap=new Map();this.methods=[];this.statics=[];this.constants=[];this.constantMap=new Map();this.sequencePoints=[];
  }
  report(node,code,message,severity='error'){if(this.diagnostics.length>=400)return;const source=this.sources.get(node.uri)??this.files[0]?.source;if(source)this.diagnostics.push(diagnostic(source,node.start??0,Math.max(1,(node.end??node.start+1)-node.start),code,message,severity));}
  requireFeature(node,version,name){let selected;try{selected=languageVersion(this.options.langVersionByUri?.[node.uri]??this.options.langVersion);}catch(error){this.report(node,'SF2140',error.message);return false;}if(version===15?!selected.preview:selected.number<version){this.report(node,version===15?'CS8652':'CS9058',`${name} requires ${version===15?'LangVersion=preview':'C# '+version+' or later'}; selected ${selected.name}`);return false;}return true;}
  constant(value){const key=JSON.stringify([typeof value,value]);if(this.constantMap.has(key))return this.constantMap.get(key);const id=this.constants.length;this.constants.push(value);this.constantMap.set(key,id);return id;}
  symbol(node,kind,type,extra={}){
    if(node.generated||node.debugHidden)return null;
    const span=node.nameSpan??{start:node.start,end:node.end}, s={id:`${node.uri}:${span.start}:${kind}`,name:node.name,kind,type,uri:node.uri,start:span.start,end:span.end,...extra};this.symbols.push(s);this.reference(node,s,true);return s;
  }
  reference(node,symbol,declaration=false){if(!symbol||node.debugHidden)return;const span=node.nameSpan??{start:node.start,end:node.end};this.references.push({symbolId:symbol.id,uri:node.uri,start:span.start,end:span.end,declaration,type:symbol.type});}
  resolveType(type,node,allowVar=false){type=normalize(type);const element=type.endsWith('[]')?type.slice(0,-2):type;if(element==='var'&&allowVar)return type;if((!supported.has(element)&&!this.typeMap.has(element)&&!frameworkType(element))||element==='var')this.report(node,'CS0246',`The type or namespace name '${type}' could not be found in this compiler profile`);return type;}
  build(){
    const start=performance.now();try{languageVersion(this.options.langVersion);for(const value of Object.values(this.options.langVersionByUri??{}))languageVersion(value);}catch(error){this.report(this.files[0]?.root??{},'SF2140',error.message);}if(this.options.checkOverflow!==undefined&&typeof this.options.checkOverflow!=='boolean'||Object.values(this.options.checkOverflowByUri??{}).some(v=>typeof v!=='boolean'))this.report(this.files[0]?.root??{},'SF2009','Overflow-check options must be boolean');
    // Two-pass declarations allow forward calls and references across source files.
    for(const file of this.files)for(const decl of file.root.members.filter(n=>n.kind==='Class')){
      if(this.typeMap.has(decl.name)){
        const existing=this.typeMap.get(decl.name);
        if((existing.node.namespace??'')!==(decl.namespace??'')){this.report(decl,'SF2011','Same-named types in different namespaces require namespace binding, which is outside this profile');continue;}
        if(!decl.modifiers.includes('partial')||!existing.declarations.every(d=>d.modifiers.includes('partial'))){this.report(decl,existing.declarations.some(d=>d.modifiers.includes('partial'))||decl.modifiers.includes('partial')?'CS0260':'CS0101',`All declarations of '${decl.name}' must be partial`);continue;}
        const access=d=>d.modifiers.filter(m=>['public','internal','private','protected'].includes(m)).sort().join(' '),specified=existing.declarations.map(access).filter(Boolean);
        if(access(decl)&&specified.some(a=>a!==access(decl)))this.report(decl,'CS0262',`Partial declarations of '${decl.name}' have conflicting accessibility`);
        existing.declarations.push(decl);this.reference(decl,existing.symbol,true);continue;
      }
      const type={id:this.types.length,name:decl.name,fields:[],properties:[],methods:[],interfaces:[],node:decl,declarations:[decl]};type.symbol=this.symbol(decl,'class',decl.name);this.types.push(type);this.typeMap.set(type.name,type);
    }
    for(const type of this.types){for(const member of type.declarations.flatMap(d=>d.members)){if(member.kind==='Field')this.declareField(type,member);else if(member.kind==='Property')this.declareProperty(type,member);else this.declareMethod(type,member,!!member.generated);}}
    for(const type of this.types){type.interfaces=[...new Set(type.declarations.flatMap(d=>d.interfaces??[]))];if(type.interfaces.includes('System.IDisposable')){const method=type.methods.find(m=>m.name==='Dispose'&&!m.isStatic&&m.parameters.length===0&&m.returnType==='void'&&m.node.modifiers.includes('public'));if(!method)this.report(type.node,'CS0535',`'${type.name}' must implement public void Dispose()`);else method.implementsDispose=true;}}
    const tops=[];
    for(const file of this.files){
      for(const node of file.root.members.filter(n=>n.kind==='Method'))this.declareMethod(null,{...node,modifiers:[...node.modifiers,'static']});
      if(file.root.statements.length)tops.push({file,statements:file.root.statements});
    }
    if(tops.length>1)this.report(tops[1].file.root,'CS8802','Only one compilation unit can have top-level statements');
    const library=this.options.outputKind==='library';if(!['exe','library'].includes(this.options.outputKind??'exe'))this.report(this.files[0]?.root??{},'SF2008','Output kind must be exe or library');
    if(library&&tops.length)this.report(tops[0].file.root,'CS8805','Programs using top-level statements must be executables');
    let entry;
    if(!library&&tops.length){const {file,statements}=tops[0];entry=this.declareMethod(null,{kind:'Method',name:'<Main>',returnType:'void',parameters:[],modifiers:['static'],body:{kind:'Block',statements,start:0,end:file.source.length,uri:file.source.uri},uri:file.source.uri,start:0,end:file.source.length});}
    else if(!library){const candidates=this.methods.filter(m=>m.name==='Main'&&m.isStatic);entry=candidates[0];if(candidates.length>1)this.report(candidates[1].node,'CS0017','Program has more than one entry point');}
    if(!library&&!entry)this.report(this.files[0]?.root??{},'CS5001',"Program does not contain a suitable static Main method or top-level statements");
    // Per-type instance initializer routines execute before constructors.
    for(const type of this.types){
      const statements=type.fields.filter(f=>f.node.initializer&&!f.isStatic).map(f=>({kind:'ExpressionStatement',uri:f.node.uri,start:f.node.start,end:f.node.end,expression:{kind:'Assignment',operator:'=',left:{kind:'Member',target:{kind:'Name',name:'this',uri:f.node.uri,start:f.node.start,end:f.node.start},name:f.name,nameSpan:f.node.nameSpan,uri:f.node.uri,start:f.node.start,end:f.node.end},right:f.node.initializer,uri:f.node.uri,start:f.node.start,end:f.node.end}}));
      if(statements.length)type.initializer=this.declareMethod(type,{...type.node,kind:'Method',name:'<init>',returnType:'void',parameters:[],modifiers:[],body:{...type.node,kind:'Block',statements}},true).id;
    }
    for(const method of [...this.methods])new MethodCompiler(this,method).build();
    // Library type initializers are real .cctor methods; the CLI has no entry-point token.
    if(library)for(const type of this.types){const fields=this.statics.filter(f=>f.owner===type&&f.node.initializer);if(!fields.length)continue;const node={...type.node,kind:'Method',name:'.cctor',parameters:[],returnType:'void',modifiers:['static'],body:{kind:'Block',statements:[],start:0,end:0,uri:type.node.uri}},method=this.declareMethod(type,node,true),b=new MethodCompiler(this,method);for(const field of fields){const actual=b.typedExpr(field.node.initializer,field.type);b.checkAssign(field.type,actual,field.node);b.emit(Op.STSTATIC,field.index);b.emit(Op.POP);}b.emitConstant(null);b.emit(Op.RET);b.finish();}
    let entryId=library?null:entry?.id??0;
    if(entry){
      if(entry.node.asyncRole==='kickoff'&&entry.returnType==='void')this.report(entry.node,'CS4009','An async entry point must return Task or Task<int>, not void');
      if(!['void','int'].includes(entry.returnType)&&!['void','int'].includes(taskResult(entry.returnType)))this.report(entry.node,'CS0028','Main must return void or int');
      if(entry.parameters.length>1||entry.parameters.length===1&&entry.parameters[0].type!=='string[]')this.report(entry.node,'CS0028','Main parameters must be empty or string[] args');
      const node={...entry.node,name:'<startup>',parameters:[],returnType:taskResult(entry.returnType)??entry.returnType,modifiers:['static'],body:{kind:'Block',statements:[],start:0,end:0,uri:entry.node.uri}};
      const startup=this.declareMethod(null,node,true), b=new MethodCompiler(this,startup);
      for(const field of this.statics){if(field.node.initializer){b.m.owner=field.owner;const type=b.typedExpr(field.node.initializer,field.type);b.checkAssign(field.type,type,field.node);b.emit(Op.STSTATIC,field.index);b.emit(Op.POP);}} b.m.owner=null;
      if(entry.parameters.length){b.emitConstant(0);b.emit(Op.NEWARR,this.constant('string'));}
      b.emit(Op.CALL,entry.id,entry.parameters.length);if(taskResult(entry.returnType)!==null){const d=findContracts('SharpForge.Runtime.Async','Await',true).find(x=>x.parameters[0]===entry.returnType),builtin=d?frameworkBuiltin(d):null;if(builtin)b.emit(Op.BUILTIN,builtin.id,1);else{this.report(entry.node,'CS0028','Unsupported entry-point task result');b.emit(Op.POP);b.emitConstant(null);}}b.emit(Op.RET);b.finish();entryId=startup.id;
    }
    const image={formatVersion:FORMAT_VERSION,name:this.options.name??'Application',...(library?{outputKind:'library'}:{}),entryPoint:entryId,constants:this.constants,sequencePoints:this.sequencePoints,
      sources:this.files.map(f=>({uri:f.source.uri,text:f.source.text,version:f.source.version})),
      types:this.types.map(t=>({id:t.id,name:t.name,...(t.interfaces.length?{interfaces:t.interfaces}:{}),fields:t.fields.filter(f=>!f.isStatic).map(f=>({name:f.name,type:f.type,index:f.index,...(f.backing?{backing:true}:{} )})),...(t.properties.length?{properties:t.properties.map(p=>({name:p.name,type:p.type,isStatic:p.isStatic,access:p.access,get:p.get?.id??null,set:p.set?.id??null,backing:p.backing?.name??null}))}:{}),initializer:t.initializer})),
      statics:this.statics.map(f=>({name:`${f.owner.name}.${f.name}`,type:f.type,value:defaultValue(f.type),...(f.backing?{backing:true}:{} )})),
      methods:this.methods.map(m=>({...(m.node?.uri&&m.node.body&&(!m.node.asyncRole||m.node.asyncRole==='body')&&!m.name.startsWith('<startup>')?{sourceRange:{uri:m.node.uri,start:m.node.start,end:m.node.end}}:{}),...(m.node.asyncRole?{asyncRole:m.node.asyncRole,asyncOrigin:m.node.asyncOrigin}:{}),id:m.id,name:m.name,qualifiedName:m.qualifiedName,owner:m.owner?.name??null,isStatic:m.isStatic,returnType:m.returnType,...(m.accessor?{accessor:m.accessor}:{}),...(m.implementsDispose?{implementsDispose:true}:{}),parameters:m.parameters.map(p=>({name:p.name,type:p.type})),locals:m.locals??[],code:m.code??new Int32Array(),handlers:m.handlers??[]}))};
    const errors=this.diagnostics.filter(d=>d.severity==='error').length;
    return {success:errors===0,image:errors===0?image:null,diagnostics:this.diagnostics,symbols:this.symbols,references:this.references,
      metrics:{compileMs:performance.now()-start,files:this.files.length,tokens:this.files.reduce((s,f)=>s+f.tokens.length,0),internedTokenHits:this.files.reduce((s,f)=>s+f.internedTokenHits,0),nodes:this.files.reduce((s,f)=>s+f.nodeCount,0),methods:this.methods.length,instructions:this.methods.reduce((s,m)=>s+(m.code?.length??0)/3,0),errors}};
  }
  declareField(owner,node){const type=this.resolveType(node.type,node),isStatic=node.modifiers.includes('static')||node.modifiers.includes('const');
    if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name))this.report(node,'CS0102',`Type '${owner.name}' already contains '${node.name}'`);
    if(node.modifiers.includes('readonly')||node.modifiers.includes('const'))this.report(node,'SF2001','readonly and const fields are not yet supported');
    if(node.modifiers.includes('partial'))this.report(node,'SF2010','partial is supported on classes, not fields');
    const field={name:node.name,type,isStatic,index:isStatic?this.statics.length:owner.fields.filter(f=>!f.isStatic).length,node,owner};field.backing=!!node.backing;field.symbol=node.backing?null:this.symbol(node,'field',type,{owner:owner.name,isStatic});owner.fields.push(field);if(isStatic)this.statics.push(field);return field;
  }
  declareProperty(owner,node){
    const type=this.resolveType(node.type,node),isStatic=node.modifiers.includes('static'),access=node.modifiers.find(m=>['public','private','internal','protected'].includes(m))??'private';
    if(['void','var'].includes(type))this.report(node,'CS0547','A property cannot have void or var type');
    if(node.modifiers.some(m=>['const','readonly','partial'].includes(m)))this.report(node,'CS0106','Unsupported property modifier');
    if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name)||owner.methods.some(m=>m.name===node.name))this.report(node,'CS0102',`Type '${owner.name}' already contains '${node.name}'`);
    if(!node.accessors.length)this.report(node,'CS0548','A property must have at least one accessor');
    if(node.accessors.filter(a=>a.modifiers.length).length>1)this.report(node,'CS0274','Only one accessor may specify accessibility');
    const property={name:node.name,type,isStatic,access,node,owner,get:null,set:null,backing:null};owner.properties.push(property);
    property.symbol=this.symbol(node,'property',type,{owner:owner.name,isStatic,access,readable:node.accessors.some(a=>a.name==='get'),writable:node.accessors.some(a=>a.name==='set')});
    const auto=node.accessors.some(a=>!a.body),fieldBacked=node.accessors.some(a=>hasBackingField(a.body)),mixed=auto&&node.accessors.some(a=>a.body),backed=auto||fieldBacked;
    if(fieldBacked||mixed)this.requireFeature(node,14,'Field-backed properties');
    if(auto&&!fieldBacked&&!node.accessors.some(a=>a.name==='get'))this.report(node,'CS8051','An auto-implemented property must have a get accessor');
    if(node.initializer&&!backed)this.report(node,'CS8050','A property initializer requires backing storage');
    if(backed)property.backing=this.declareField(owner,{...node,kind:'Field',name:`<${node.name}>k__BackingField`,backing:true,modifiers:isStatic?['static']:[],initializer:node.initializer});
    for(const accessor of node.accessors){
      if(!['get','set'].includes(accessor.name))continue;
      if(property[accessor.name]){this.report(accessor,'CS1007',`Duplicate '${accessor.name}' accessor`);continue;}
      const specified=accessor.modifiers.filter(m=>['private','internal','protected','public'].includes(m));
      if(accessor.modifiers.length!==specified.length||specified.length>1)this.report(accessor,'CS0106','Invalid accessor modifier');
      const visibility=specified[0]??access;
      if(specified.length&&(node.accessors.length!==2||visibility===access||visibility==='public'||access==='private'||access==='internal'&&visibility!=='private'||access==='protected'&&visibility!=='private'))this.report(accessor,'CS0273','Accessor accessibility must be more restrictive than the property');
      let body=fieldBacked?rewriteBackingField(accessor.body,property.backing.name,n=>this.report(n,'CS9272',"'field' cannot be declared inside a field-backed accessor; use @field")):accessor.body;
      if(!body){const field={...node,kind:'Name',name:property.backing.name};const expression=accessor.name==='get'?field:{...node,kind:'Assignment',operator:'=',left:field,right:{...accessor,kind:'Name',name:'value'}};
        body={...accessor,kind:'Block',statements:[{...accessor,kind:accessor.name==='get'?'Return':'ExpressionStatement',expression}]};}
      const method=this.declareMethod(owner,{...node,kind:'Method',name:accessor.name+'_'+node.name,returnType:accessor.name==='get'?type:'void',parameters:accessor.name==='get'?[]:[{...accessor,kind:'Parameter',name:'value',type}],modifiers:isStatic?['static']:[],body},true);
      method.accessor={property:node.name,kind:accessor.name,access:visibility};property[accessor.name]=method;
    }
    return property;
  }
  declareMethod(owner,node,synthetic=false){
    if(!synthetic&&owner?.properties.some(p=>p.name===node.name))this.report(node,'CS0102',`Type '${owner.name}' already contains '${node.name}'`);
    if(!synthetic&&node.modifiers.includes('partial'))this.report(node,'SF2010','Partial methods are not supported; partial class fields and ordinary methods are supported');
    const parameters=node.parameters.map(p=>({...p,type:this.resolveType(p.type,p)})),returnType=this.resolveType(node.returnType,node),isStatic=node.modifiers.includes('static')||!owner;
    const method={id:this.methods.length,name:node.name,qualifiedName:(owner?owner.name+'.':'')+node.name,returnType,parameters,isStatic,owner,node,synthetic};
    if(this.methods.some(m=>m.owner===owner&&m.name===method.name&&m.parameters.map(p=>p.type).join(',')===parameters.map(p=>p.type).join(',')))this.report(node,'CS0111',`Method '${method.qualifiedName}' with these parameters is already defined`);
    if(!synthetic)method.symbol=this.symbol(node,'method',returnType,{owner:owner?.name,isStatic,bodyStart:node.start,bodyEnd:node.end,parameters:parameters.map(p=>({name:p.name,type:p.type}))});this.methods.push(method);owner?.methods.push(method);return method;
  }
}
class MethodCompiler {
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
    if(this.scopes.some(s=>s.has(name)))this.c.report(node,'CS0136',`A local or parameter named '${name}' is already defined in an enclosing scope`);
    const slot=this.locals.length,symbol=hidden?null:this.c.symbol({...node,name},'local',type,{method:this.m.qualifiedName,scopeStart:this.scopeNode?.start??this.m.node.start,scopeEnd:this.scopeNode?.end??this.m.node.end});
    const local={name,type,slot,symbol,hidden,scopeStartPc:this.pc,isConst:node.isConst??false,isUsing:node.isUsing??false,isIteration:node.isIteration??false,declaredAt:node.start,scopeEnd:this.scopeNode?.end??this.m.node.end};this.locals.push(local);this.scopes.at(-1).set(name,local);if(assigned)this.assigned.add(slot);return local;
  }
  closeScope(){const scope=this.scopes.pop();for(const l of scope.values())l.scopeEndPc=this.pc;return scope;}
  lookup(name){for(let i=this.scopes.length-1;i>=0;i--){const l=this.scopes[i].get(name);if(l)return l;}return null;}
  seq(node){if(node.debugHidden)return;const source=this.c.sources.get(node.uri);if(!source)return;const pos=source.positionAt(node.start),point={id:this.c.sequencePoints.length,methodId:this.m.id,offset:this.pc,uri:node.uri,start:node.start,end:node.end,line:pos.line+1,column:pos.character+1};this.c.sequencePoints.push(point);this.emit(Op.SEQ,point.id);}
  build(){this.stmt(this.m.node.body);if(this.m.returnType!=='void'&&!alwaysReturns(this.m.node.body))this.c.report(this.m.node,'CS0161',`Not all code paths return a value in '${this.m.qualifiedName}'`);this.emitConstant(defaultValue(this.m.returnType));this.emit(Op.RET);this.finish();}
  finish(){this.m.code=Int32Array.from(this.code);this.m.locals=this.locals.map(({symbol,...l})=>({...l,...(!l.hidden?{scopeEndPc:l.scopeEndPc??this.pc}:{})}));this.m.handlers=this.handlers;}
  checkAssign(target,from,node){if(!assignable(target,from))this.c.report(node,'CS0029',`Cannot implicitly convert type '${from}' to '${target}'`);}
  bool(node){const t=this.expr(node);this.checkAssign('bool',t,node);}
  stmt(node){if(!node)return;
    switch(node.kind){
      case 'Block':{const previous=this.scopeNode;this.scopeNode=node;this.scopes.push(new Map());this.statementList(node.statements);for(const local of this.scopes.at(-1).values())if(isReference(local.type))this.clear(local.slot);this.closeScope();this.scopeNode=previous;break;}
      case 'Empty':break;
      case 'Using':this.stmt(this.lowerUsing(node));break;
      case 'UsingDeclaration':this.c.report(node,'CS1023','A using declaration requires an enclosing statement block');break;
      case 'Local':this.seq(node);if(node.declarations.some(d=>d.isConst&&d.type==='var'))this.c.report(node,'CS0822','Implicitly typed variables cannot be const');if(node.declarations.length>1&&node.declarations.some(d=>d.type==='var'))this.c.report(node,'CS0819','Implicitly typed variables cannot have multiple declarators');for(const d of node.declarations){let declared=this.c.resolveType(d.type,d,true),initType;
        if(d.initializer)initType=this.typedExpr(d.initializer,declared==='var'?null:declared);if(declared==='var'){if(!d.initializer||initType==='null'||initType==='void')this.c.report(d,'CS0818','Implicitly typed variables require a non-null value initializer');declared=initType??'error';}
        if(declared==='void')this.c.report(d,'CS1547','void cannot be used as a variable type');
        const l=this.local(d.name,declared,d,false,!!d.hidden);if(d.initializer){this.checkAssign(declared,initType,d);this.emit(Op.STLOC,l.slot);this.emit(Op.POP);this.assigned.add(l.slot);}if(d.isConst&&!d.initializer)this.c.report(d,'CS0145','A const local requires an initializer');else if(d.isConst){const value=this.constant(d.initializer);if(!value)this.c.report(d,'CS0133','A const local initializer must be a constant expression');else l.constantValue={...value,type:declared};}}break;
      case 'ExpressionStatement':this.seq(node);this.expr(node.expression);this.emit(Op.POP);if(!['Call','Await','Assignment','New'].includes(node.expression.kind)&&!(node.expression.kind==='Unary'&&['++','--'].includes(node.expression.operator)))this.c.report(node,'CS0201','Only assignment, call, increment, decrement and new expressions can be used as statements');break;
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
        this.scopes.push(new Map());this.seq({...node,end:node.expression.end});const arrayType=this.expr(node.expression);if(!arrayType.endsWith('[]'))this.c.report(node,'CS1579','foreach currently requires an array');const element=arrayType.endsWith('[]')?arrayType.slice(0,-2):'error',arr=this.temp(arrayType),index=this.temp('int');this.emit(Op.STLOC,arr);this.emit(Op.POP);this.emitConstant(0);this.emit(Op.STLOC,index);this.emit(Op.POP);
        const l=this.local(node.name,node.type==='var'?element:this.c.resolveType(node.type,node),{...node,isIteration:true},true);this.checkAssign(l.type,element,node);const start=this.pc;this.seq({...node,end:node.expression.end});this.emit(Op.LDLOC,index);this.emit(Op.LDLOC,arr);this.emit(Op.LENGTH);this.emit(Op.BINARY,Binary['<']);const exit=this.emit(Op.JFALSE);this.emit(Op.LDLOC,arr);this.emit(Op.LDLOC,index);this.emit(Op.LDELEM);this.emit(Op.STLOC,l.slot);this.emit(Op.POP);
        const loop={breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.stmt(node.body);for(const p of loop.continues)this.patch(p);this.emit(Op.LDLOC,index);this.emitConstant(1);this.emit(Op.BINARY,Binary['+'],1);this.emit(Op.STLOC,index);this.emit(Op.POP);this.emit(Op.JUMP,start);this.patch(exit);for(const p of loop.breaks)this.patch(p);this.loops.pop();this.clear(arr);for(const local of this.scopes.at(-1).values())if(isReference(local.type))this.clear(local.slot);this.closeScope();break;}
      case 'Break':case 'Continue':{this.seq(node);if(node.label)this.c.requireFeature(node,15,'Labeled break and continue');const loop=node.label?[...this.loops].reverse().find(l=>l.labels?.includes(node.label)&&(node.kind!=='Continue'||!l.switch)):node.kind==='Continue'?[...this.loops].reverse().find(l=>!l.switch):this.loops.at(-1);if(loop&&this.finallyScopes.length&&!this.loops.slice(this.finallyScopes.at(-1)).includes(loop))this.c.report(node,'CS0157','Control cannot leave a finally clause');if(!loop)this.c.report(node,'CS0139',`No enclosing loop or switch for ${node.kind.toLowerCase()}`);else loop[node.kind==='Break'?'breaks':'continues'].push(this.emit(Op.JUMP));break;}
      case 'Switch':this.switchStatement(node);break;
      case 'Return':if(this.finallyScopes.length)this.c.report(node,'CS0157','Control cannot leave a finally clause');this.seq(node);if(node.expression){const type=this.typedExpr(node.expression,this.m.returnType);this.checkAssign(this.m.returnType,type,node);}else{if(this.m.returnType!=='void')this.c.report(node,'CS0126','An object of the method return type is required');this.emitConstant(null);}this.emit(Op.RET);break;
      case 'Throw':this.seq(node);if(node.expression){const type=this.expr(node.expression);if(type!=='Exception'&&type!=='null'&&type!=='error')this.c.report(node,'CS0155','The type thrown must be Exception');this.emit(Op.THROW);}else{if(!this.catchDepth)this.c.report(node,'CS0156','A throw statement with no arguments is not allowed outside a catch clause');this.emit(Op.RETHROW);}break;
      case 'Try':{
        if(node.finallyBody){
          const start=this.pc,before=new Set(this.assigned);
          if(node.catches.length)this.stmt({...node,finallyBody:null});else this.stmt(node.body);
          if(this.pc===start)this.emit(Op.NOP);const normalAssigned=new Set(this.assigned),end=this.pc,jump=this.emit(Op.JUMP),handler={kind:'finally',start,end,target:this.pc,handlerEnd:0};this.handlers.push(handler);
          this.assigned=new Set(before);this.finallyScopes.push(this.loops.length);this.stmt(node.finallyBody);this.finallyScopes.pop();this.emit(Op.ENDFINALLY);handler.handlerEnd=this.pc;this.patch(jump);for(const slot of normalAssigned)this.assigned.add(slot);break;
        }
        const start=this.pc,before=new Set(this.assigned);this.stmt(node.body);if(this.pc===start)this.emit(Op.NOP);const end=this.pc,jumps=[this.emit(Op.JUMP)];
        for(const ca of node.catches){this.scopes.push(new Map());this.assigned=new Set(before);const type=this.c.resolveType(ca.type,node);if(type!=='Exception')this.c.report(node,'SF2002','Only catch(Exception) and catch-all are supported');const slot=this.temp('Exception');if(ca.name){const l=this.local(ca.name,'Exception',{...ca.body,name:ca.name,nameSpan:ca.nameSpan},true);l.scopeEnd=ca.body.end;this.locals[slot].hidden=true;this.handlers.push({start,end,target:this.pc,slot:l.slot,type});}else this.handlers.push({start,end,target:this.pc,slot,type});this.catchDepth++;this.stmt(ca.body);this.catchDepth--;jumps.push(this.emit(Op.JUMP));this.closeScope();}
        for(const jump of jumps)this.patch(jump);this.assigned=before;break;}
      default:this.c.report(node,'SF2099',`Statement '${node.kind}' is not implemented`);
    }
  }
  statementList(statements){
    for(let i=0;i<statements.length;i++){const s=statements[i];if(s.kind==='UsingDeclaration'){this.stmt({...s,kind:'Using',body:{...s,kind:'Block',end:statements.at(-1)?.end??s.end,statements:statements.slice(i+1)}});return;}this.stmt(s);}
  }
  lowerUsing(node){
    if(node.resources.kind==='Local'&&node.resources.declarations.length>1&&node.resources.declarations.some(d=>d.type==='var'))this.c.report(node,'CS0819','Implicitly typed variables cannot have multiple declarators');
    const declarations=node.resources.kind==='Local'?node.resources.declarations:[{...node.resources,kind:'Variable',name:`$using${this.locals.length}_${this.pc}`,type:'var',initializer:node.resources,hidden:true}];
    const lower=index=>{
      if(index>=declarations.length)return node.body;
      const d=declarations[index],type=d.type==='var'?this.infer(d.initializer):normalize(d.type),owner=this.c.typeMap.get(type);
      if(!d.initializer)this.c.report(d,'CS0210','A using variable must have an initializer');
      if(!owner?.interfaces.includes('System.IDisposable')&&!(['network','bcl','bcl14'].includes(frameworkType(type)?.kind)&&findContracts(type,'Dispose',false).some(c=>!c.parameters.length)))this.c.report(d,'CS1674',`Using resource '${type}' must implement IDisposable in this profile`);
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
    this.c.report(node??this.m.node,'CS0150','This profile requires an int, string, bool or null constant pattern');return {value:null,type:'error'};
  }
  switchDispatch(node,groups){
    this.seq({...node,end:node.expression.end});const type=this.expr(node.expression),slot=this.temp(type);if(!['int','string','bool'].includes(type))this.c.report(node,'CS0151','Switch governing type must be int, string or bool in this profile');this.emit(Op.STLOC,slot);this.emit(Op.POP);
    const branches=groups.map(()=>[]),seen=new Set();let fallback=-1;
    groups.forEach((labels,index)=>labels.forEach(label=>{if(label===null){if(fallback>=0)this.c.report(node,'CS0152','Duplicate default arm');fallback=index;return;}const constant=this.constantPattern(label),key=JSON.stringify([constant.type,constant.value]);if(seen.has(key))this.c.report(label,'CS0152','Duplicate constant pattern');seen.add(key);this.checkAssign(type,constant.type,label);this.emit(Op.LDLOC,slot);this.emitConstant(constant.value,constant.type);this.emit(Op.BINARY,Binary['==']);branches[index].push(this.emit(Op.JTRUE));}));
    return {branches,fallback,otherwise:this.emit(Op.JUMP),slot};
  }
  switchStatement(node){
    const before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.sections.map(s=>s.labels)),loop={switch:true,breaks:[],continues:[],labels:node.labels??[]};this.loops.push(loop);this.scopes.push(new Map());
    const ends=[];node.sections.forEach((section,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);for(const s of section.statements)this.stmt(s);const terminal=s=>alwaysReturns(s)||['Break','Continue'].includes(s?.kind)||s?.kind==='Block'&&terminal(s.statements.at(-1))||s?.kind==='If'&&terminal(s.then)&&terminal(s.otherwise);if(section.statements.length&&!terminal(section.statements.at(-1)))this.c.report(section,'CS0163','Control cannot fall through a switch section');ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0)this.patch(dispatch.otherwise);for(const p of [...ends,...loop.breaks])this.patch(p);this.loops.pop();for(const local of this.scopes.at(-1).values())this.clear(local.slot);this.closeScope();this.clear(dispatch.slot);this.assigned=before;
  }
  switchType(node){const types=node.arms.map(a=>this.infer(a.expression));return types.includes('double')&&types.every(t=>numeric(t))?'double':types.find(t=>t!=='null')??'error';}
  switchExpression(node){
    const type=this.switchType(node),before=new Set(this.assigned),dispatch=this.switchDispatch(node,node.arms.map(a=>[a.pattern])),ends=[],assigned=[];
    node.arms.forEach((arm,index)=>{for(const p of dispatch.branches[index])this.patch(p);if(dispatch.fallback===index)this.patch(dispatch.otherwise);this.assigned=new Set(before);this.checkAssign(type,this.expr(arm.expression),arm);assigned.push(new Set(this.assigned));ends.push(this.emit(Op.JUMP));});
    if(dispatch.fallback<0){this.patch(dispatch.otherwise);this.emitConstant('No switch expression arm matched.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);this.emit(Op.THROW);this.c.report(node,'CS8509','Switch expression does not contain a discard (_) arm','warning');}
    for(const p of ends)this.patch(p);this.clear(dispatch.slot);this.assigned=assigned.length?new Set([...assigned[0]].filter(x=>assigned.every(s=>s.has(x)))):before;return type;
  }
  property(node){
    if(node.kind==='Name')return this.lookup(node.name)?null:this.m.owner?.properties.find(p=>p.name===node.name)??null;
    if(node.kind!=='Member')return null;
    const named=this.c.typeMap.get(pathOf(node.target));if(named)return named.properties.find(p=>p.name===node.name&&p.isStatic)??null;
    return this.c.typeMap.get(this.infer(node.target))?.properties.find(p=>p.name===node.name&&!p.isStatic)??null;
  }
  propertyAccess(property,node,kind){
    const method=property[kind];this.c.reference(node,property.symbol);
    if(!method){this.c.report(node,kind==='get'?'CS0154':'CS0200',`Property '${property.name}' has no ${kind} accessor`);return null;}
    if(['private','protected'].includes(method.accessor.access)&&this.m.owner!==property.owner)this.c.report(node,'CS0272',`The ${kind} accessor of '${property.name}' is inaccessible`);
    if(!property.isStatic&&node.kind==='Name'&&!this.lookup('this'))this.c.report(node,'CS0120','An object reference is required for this property');
    return method;
  }
  propertyReceiver(property,node){if(!property.isStatic){if(node.kind==='Member')this.expr(node.target);else this.emit(Op.LDLOC,this.lookup('this')?.slot??0);}}
  readProperty(property,node){const getter=this.propertyAccess(property,node,'get');if(getter){this.propertyReceiver(property,node);this.emit(Op.CALL,getter.id,property.isStatic?0:1);}else this.emitConstant(null);return property.type;}
  field(node){
    if(node.kind==='Name')return this.m.owner?.fields.find(f=>f.name===node.name)??null;
    const path=pathOf(node.target),owner=this.c.typeMap.get(path);if(owner)return owner.fields.find(f=>f.name===node.name&&f.isStatic)??null;
    const type=this.infer(node.target);return this.c.typeMap.get(type)?.fields.find(f=>f.name===node.name&&!f.isStatic)??null;
  }
  isNameof(node){return node?.kind==='Call'&&node.target.kind==='Name'&&node.target.name==='nameof'&&!this.c.methods.some(m=>m.name==='nameof'&&(m.owner===this.m.owner||!m.owner));}
  nameof(node,bind=true){
    const argument=node.args[0];if(node.args.length!==1||!argument||!['Name','Member'].includes(argument.kind)){if(bind)this.c.report(node,'CS8081','nameof requires one variable, type, namespace or member name');return '';}
    // The restricted profile supports identifier/member chains, not arbitrary receiver expressions.
    const path=pathOf(argument);if(!path||path.includes('null.')){if(bind)this.c.report(argument,'CS8081','This nameof profile requires a name or member chain');return '';}
    let symbol=null,valid=false;
    if(argument.kind==='Name'){
      const local=this.lookup(argument.name),field=this.m.owner?.fields.find(f=>f.name===argument.name)??this.m.owner?.properties.find(p=>p.name===argument.name),type=this.c.typeMap.get(argument.name),methods=this.c.methods.filter(m=>m.name===argument.name&&(m.owner===this.m.owner||!m.owner));
      symbol=local?.symbol??field?.symbol??type?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!local||!!field||!!type||methods.length>0||['System','Console','Math','GC','Array','Convert','Debug','Exception'].includes(argument.name);
    }else{
      const receiver=pathOf(argument.target),local=argument.target.kind==='Name'?this.lookup(receiver):null,type=this.c.typeMap.get(receiver??'')??this.c.typeMap.get(this.infer(argument.target)),field=type?.fields.find(f=>f.name===argument.name)??type?.properties.find(p=>p.name===argument.name),methods=type?.methods.filter(m=>m.name===argument.name)??[];
      symbol=field?.symbol??(methods.length===1?methods[0].symbol:null);valid=!!field||methods.length>0||BuiltinMap.has(path.replace(/^System\./,''))||path==='System.Console'||path==='System.Math'||path==='System.GC'||path==='System.Exception'||path==='System.String'||path==='System.Int32'||argument.name==='Length'&&(local?.type==='string'||local?.type?.endsWith('[]'));
      if(bind&&local?.symbol)this.c.reference(argument.target,local.symbol);
    }
    if(!valid&&bind)this.c.report(argument,'CS0103',`The name '${path}' does not exist in this nameof context`);
    if(bind&&symbol)this.c.reference(argument,symbol);return argument.name;
  }
  infer(node){
    if(!node)return 'error';const external=this.frameworkInfer(node);if(external!==undefined)return external;switch(node.kind){
      case 'Await':return taskResult(this.infer(node.expression))??'error';case 'Checked':case 'Unchecked':return this.infer(node.expression);case 'Cast':case 'Default':return normalize(node.type);case 'SwitchExpression':return this.switchType(node);
      case 'InterpolatedString':return 'string';case 'Literal':return node.type;case 'Name':return this.lookup(node.name)?.type??this.property(node)?.type??this.m.owner?.fields.find(f=>f.name===node.name)?.type??'error';
      case 'New':return normalize(node.type);case 'NewArray':return node.type==='var[]'?(node.values?.length?this.infer(node.values[0])+'[]':'error[]'):node.type;
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
    else if(target.kind==='Member'){const path=pathOf(target.target),type=this.c.typeMap.get(path);if(type)candidates=type.methods.filter(m=>m.name===target.name&&m.isStatic);else{const type=this.c.typeMap.get(this.infer(target.target));candidates=type?.methods.filter(m=>m.name===target.name&&!m.isStatic)??[];}}
    if(candidates.some(m=>m.accessor)){if(report)this.c.report(node,'CS0571','Property accessors cannot be called explicitly');candidates=candidates.filter(m=>!m.accessor);}
    const types=node.args.map(a=>this.infer(a));candidates=candidates.filter(m=>m.parameters.length===types.length&&m.parameters.every((p,i)=>assignable(p.type,types[i])));
    candidates.sort((a,b)=>a.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)-b.parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0));
    if(!candidates.length&&report)this.c.report(node,'CS1501',`No applicable method '${pathOf(target)??'<expression>'}' accepts these argument types`);
    if(candidates.length>1&&candidates[0].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)===candidates[1].parameters.reduce((s,p,i)=>s+(p.type===types[i]?0:1),0)&&report)this.c.report(node,'CS0121','The call is ambiguous between two methods');
    return candidates[0]??null;
  }
  overflowChecked(node){return this.checkedContext??this.c.options.checkOverflowByUri?.[node?.uri??this.m.node.uri]??this.c.options.checkOverflow??false;}
  constant(node){try{return evaluateConstant(node,{checked:this.checkedContext!==false,resolve:n=>n.kind==='Name'?this.lookup(n.name)?.constantValue??null:null});}catch(error){if(!(error instanceof ConstantError))throw error;const key=error.node.start+':'+error.code;if(!this.constantDiagnostics.has(key)){this.constantDiagnostics.add(key);this.c.report(error.node,error.code,error.message);}return null;}}
  expr(node){
    if(!node){this.emitConstant(null);return 'error';}const external=this.frameworkExpression(node);if(external!==undefined)return external;
    if(['Binary','Unary','Cast'].includes(node.kind))this.constant(node);
    switch(node.kind){
      case 'InterpolatedString':{
        this.emitConstant('');const format=findContracts('SharpForge.Runtime.Formatting','FormatValue',true)[0];
        for(const part of node.parts){if(part.text!==undefined)this.emitConstant(part.text);else{const type=this.expr(part.expression);if(type==='void')this.c.report(part.expression,'CS0029','A void expression cannot be interpolated');this.emitConstant(part.format);this.emitConstant(part.alignment);this.emitConstant(type);this.emitContract(format);}this.emit(Op.BINARY,Binary['+'],2);}return 'string';
      }
      case 'Await':{if(!this.m.node.asyncBody&&!this.m.name.startsWith('<startup>'))this.c.report(node,'CS4032','await requires an async method');const type=this.expr(node.expression),d=findContracts('SharpForge.Runtime.Async','Await',true).find(x=>x.parameters[0]===type);if(!d){this.c.report(node,'CS1061',`Type '${type}' has no supported awaiter`);return 'error';}const builtin=frameworkBuiltin(d);this.emit(Op.BUILTIN,builtin.id,1);return d.result;}
      case 'Default':{const type=this.c.resolveType(node.type,node);if(type==='void')this.c.report(node,'CS1547','default(void) is invalid');this.emitConstant(defaultValue(type),type);return type;}
      case 'Checked':case 'Unchecked':{const previous=this.checkedContext;this.checkedContext=node.kind==='Checked';try{return this.expr(node.expression);}finally{this.checkedContext=previous;}}
      case 'Cast':{const from=this.expr(node.expression),to=this.c.resolveType(node.type,node);if(!numeric(from)||!numeric(to))this.c.report(node,'CS0030',`Cannot convert '${from}' to '${to}'`);this.emit(Op.CONVERT,to==='int'?0:1,this.overflowChecked(node)&&to==='int'?1:0);return to;}
      case 'SwitchExpression':return this.switchExpression(node);
      case 'Error':this.emitConstant(null);return 'error';
      case 'Literal':if(node.type==='char')this.c.report(node,'SF2003','char values are not supported by this execution profile');if(node.type==='int'&&node.value>2147483647)this.c.report(node,'SF2004','Positive integer literal exceeds Int32.MaxValue');this.emitConstant(node.value,node.type);return node.type;
      case 'Name':{
        const l=this.lookup(node.name);if(l){if(!this.assigned.has(l.slot))this.c.report(node,'CS0165',`Use of unassigned local variable '${l.name}'`);if(l.symbol)this.c.reference(node,l.symbol);this.emit(Op.LDLOC,l.slot);return l.type;}
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);if(f.isStatic)this.emit(Op.LDSTATIC,f.index);else{const self=this.lookup('this');if(!self)this.c.report(node,'CS0120','An object reference is required for this field');this.emit(Op.LDLOC,self?.slot??0);this.emit(Op.LDFLD,f.index);}return f.type;}
        this.c.report(node,'CS0103',`The name '${node.name}' does not exist in the current context`);this.emitConstant(null);return 'error';}
      case 'Member':{
        const type=this.infer(node.target);
        if(node.name==='Length'&&(type==='string'||type.endsWith('[]'))){this.expr(node.target);this.emit(Op.LENGTH);return 'int';}
        if(node.name==='Message'&&type==='Exception'){this.expr(node.target);this.emit(Op.BUILTIN,BuiltinMap.get('Exception.Message').id,1);return 'string';}
        if(pathOf(node)==='Environment.TickCount'||pathOf(node)==='System.Environment.TickCount'){this.emit(Op.BUILTIN,BuiltinMap.get('Environment.TickCount').id,0);return 'int';}
        const property=this.property(node);if(property)return this.readProperty(property,node);
        const f=this.field(node);if(f){this.c.reference(node,f.symbol);if(f.isStatic)this.emit(Op.LDSTATIC,f.index);else{this.expr(node.target);this.emit(Op.LDFLD,f.index);}return f.type;}
        this.c.report(node,'CS1061',`'${type}' does not contain member '${node.name}'`);this.emitConstant(null);return 'error';}
      case 'Index':{const type=this.expr(node.target);const index=this.expr(node.index);this.checkAssign('int',index,node.index);if(!type.endsWith('[]'))this.c.report(node,'SF2005','Indexing currently requires an array');this.emit(Op.LDELEM);return type.endsWith('[]')?type.slice(0,-2):'error';}
      case 'Binary':{
        if(['&&','||','??'].includes(node.operator)){
          const lt=this.expr(node.left);this.emit(Op.DUP);let jump;
          if(node.operator==='??'){if(!isReference(lt)&&lt!=='null'&&lt!=='error')this.c.report(node,'CS0019',"Operator '??' requires a reference type");this.emitConstant(null);this.emit(Op.BINARY,Binary['!=']);jump=this.emit(Op.JTRUE);}else{this.checkAssign('bool',lt,node.left);jump=this.emit(node.operator==='&&'?Op.JFALSE:Op.JTRUE);}
          this.emit(Op.POP);const beforeRight=new Set(this.assigned);const rt=this.expr(node.right);this.assigned=beforeRight;if(node.operator!=='??')this.checkAssign('bool',rt,node.right);else if(lt!=='null')this.checkAssign(lt,rt,node);this.patch(jump);return node.operator==='??'?(lt==='null'?rt:lt):'bool';
        }
        const left=this.expr(node.left),right=this.expr(node.right);return this.binary(node.operator,left,right,node);}
      case 'Unary':{
        if(['++','--'].includes(node.operator)){
          const ref=this.prepare(node.operand);this.loadRef(ref);const previous=node.postfix?this.temp(ref.type):null;if(previous!==null){this.emit(Op.STLOC,previous);}this.emitConstant(1);this.binary(node.operator==='++'?'+':'-',ref.type,'int',node);this.storeRef(ref);if(previous!==null){this.emit(Op.POP);this.emit(Op.LDLOC,previous);}return ref.type;
        }
        if(node.operator==='-'&&node.operand.kind==='Literal'&&node.operand.type==='int'&&node.operand.value===2147483648){this.emitConstant(-2147483648);return 'int';}
        const type=this.expr(node.operand);if(node.operator==='!')this.checkAssign('bool',type,node);else if(!numeric(type))this.c.report(node,'CS0023',`Operator '${node.operator}' cannot be applied to '${type}'`);if(node.operator==='~')this.checkAssign('int',type,node);this.emit(Op.UNARY,Unary[node.operator],type==='int'?(this.overflowChecked(node)&&node.operator==='-'?5:1):0);return node.operator==='!'?'bool':type;}
      case 'Assignment':{const ref=this.prepare(node.left,node.operator==='=');if(node.operator==='??='){if(!isReference(ref.type))this.c.report(node,'CS0019','??= requires a reference target');this.loadRef(ref);this.emit(Op.DUP);this.emitConstant(null);this.emit(Op.BINARY,Binary['==']);const done=this.emit(Op.JFALSE);this.emit(Op.POP);this.checkAssign(ref.type,this.typedExpr(node.right,ref.type),node);this.storeRef(ref);this.patch(done);return ref.type;}if(node.operator==='='){const type=this.typedExpr(node.right,ref.type);this.checkAssign(ref.type,type,node);}else{this.loadRef(ref);const type=this.expr(node.right);const result=this.binary(node.operator.slice(0,-1),ref.type,type,node);this.checkAssign(ref.type,result,node);}this.storeRef(ref);return ref.type;}
      case 'Conditional':{this.bool(node.condition);const before=new Set(this.assigned),no=this.emit(Op.JFALSE),yesType=this.expr(node.whenTrue),yesAssigned=new Set(this.assigned),done=this.emit(Op.JUMP);this.patch(no);this.assigned=new Set(before);const noType=this.expr(node.whenFalse);this.assigned=new Set([...yesAssigned].filter(s=>this.assigned.has(s)));this.patch(done);if(!assignable(yesType,noType)&&!assignable(noType,yesType))this.c.report(node,'CS0173','The conditional expression branches have incompatible types');return yesType==='null'?noType:yesType==='double'||noType==='double'?'double':yesType;}
      case 'Call':{
        if(this.isNameof(node)){this.emitConstant(this.nameof(node));return 'string';}
        const builtin=this.findBuiltin(node);if(builtin){let count=0,types=[];const staticPath=pathOf(node.target)?.replace(/^System\./,'');if(staticPath!==builtin.name&&node.target.kind==='Member'){types.push(this.expr(node.target.target));count++;}
          for(const a of node.args){types.push(this.expr(a));count++;}if(count<builtin.min||count>builtin.max)this.c.report(node,'CS1501',`'${builtin.name}' expects ${builtin.min===builtin.max?builtin.min:builtInRange(builtin)} total arguments`);
          types.forEach((type,i)=>{const target=builtin.params[i];if(target==='number'){if(!numeric(type))this.c.report(node,'CS1503',`Argument ${i+1} must be numeric`);}else if(target==='array'){if(!type.endsWith('[]'))this.c.report(node,'CS1503','Argument must be an array');}else if(target&&target!=='any'&&target!=='exception')this.checkAssign(target,type,node.args[Math.max(0,i-(count-node.args.length))]??node);});
          this.emit(Op.BUILTIN,builtin.name==='Math.Abs'&&types[0]==='int'?BuiltinMap.get('$Math.Abs.Int32').id:builtin.id,count);return builtin.result==='numeric'?(types.includes('double')?'double':'int'):builtin.result;
        }
        const method=this.findMethod(node);let count=node.args.length;if(method&&!method.isStatic){if(node.target.kind==='Member')this.expr(node.target.target);else this.emit(Op.LDLOC,this.lookup('this')?.slot??0);count++;}
        node.args.forEach((arg,i)=>{const type=this.typedExpr(arg,method?.parameters[i]?.type);if(method)this.checkAssign(method.parameters[i]?.type??'error',type,arg);});
        if(method){if(method.symbol){this.c.reference(node.target,method.symbol);const reference=this.c.references.at(-1);reference.call=true;reference.callerId=this.m.symbol?.id??null;}this.emit(Op.CALL,method.id,count);return method.returnType;}
        for(let i=0;i<count;i++)this.emit(Op.POP);this.emitConstant(null);return 'error';}
      case 'NewArray':{
        let type=node.type;if(type==='var[]'){if(!node.values?.length)this.c.report(node,'CS0826','No best type found for implicitly-typed array');type=(node.values?.length?this.infer(node.values[0]):'error')+'[]';}
        type=this.c.resolveType(type,node);const element=type.slice(0,-2);
        if(node.length)this.checkAssign('int',this.expr(node.length),node.length);else this.emitConstant(node.values?.length??0);
        this.emit(Op.NEWARR,this.c.constant(element));
        if(node.values)node.values.forEach((value,i)=>{this.emit(Op.DUP);this.emitConstant(i);this.checkAssign(element,this.typedExpr(value,element),value);this.emit(Op.STELEM);this.emit(Op.POP);});return type;}
      case 'New':{if(node.collectionInitializers?.length)this.c.report(node,'SF2013','Collection initializers require a registered collection Add contract');
        const name=normalize(node.type);if(name==='Exception'){if(node.args.length>1)this.c.report(node,'CS1501','Exception supports only a message constructor');if(node.args.length)this.checkAssign('string',this.expr(node.args[0]),node.args[0]);else this.emitConstant('An exception was thrown.');this.emit(Op.BUILTIN,BuiltinMap.get('Exception.new').id,1);return 'Exception';}
        const type=this.c.typeMap.get(name);if(!type){this.c.report(node,'CS0246',`Cannot construct unknown type '${name}'`);this.emitConstant(null);return 'error';}
        this.emit(Op.NEWOBJ,type.id);const slot=this.temp(name);this.emit(Op.STLOC,slot);this.emit(Op.POP);
        if(type.initializer!==undefined){this.emit(Op.LDLOC,slot);this.emit(Op.CALL,type.initializer,1);this.emit(Op.POP);}
        const ctors=type.methods.filter(m=>m.name==='.ctor'),ctor=ctors.find(m=>m.parameters.length===node.args.length&&m.parameters.every((p,i)=>assignable(p.type,this.infer(node.args[i]))));
        if(ctor){this.emit(Op.LDLOC,slot);for(let i=0;i<node.args.length;i++)this.typedExpr(node.args[i],ctor.parameters[i].type);this.emit(Op.CALL,ctor.id,node.args.length+1);this.emit(Op.POP);}else if(node.args.length||ctors.length)this.c.report(node,'CS1729',`'${name}' does not contain a matching constructor`);
        for(const init of node.initializers){const property=type.properties.find(p=>p.name===init.name&&!p.isStatic),field=type.fields.find(f=>f.name===init.name&&!f.isStatic);if(!property&&!field){this.c.report(init,'CS0117',`'${name}' has no field or property '${init.name}'`);continue;}
          if(property){const setter=this.propertyAccess(property,{...init,kind:'Member'},'set');if(setter){this.emit(Op.LDLOC,slot);this.checkAssign(property.type,this.typedExpr(init.expression,property.type),init);this.emit(Op.CALL,setter.id,2);this.emit(Op.POP);}}
          else {this.c.reference(init,field.symbol);this.emit(Op.LDLOC,slot);this.checkAssign(field.type,this.typedExpr(init.expression,field.type),init);this.emit(Op.STFLD,field.index);this.emit(Op.POP);}}
        this.emit(Op.LDLOC,slot);this.clear(slot);return name;}
      default:this.c.report(node,'SF2098',`Expression '${node.kind}' is not implemented`);this.emitConstant(null);return 'error';
    }
  }
  binary(operator,left,right,node){
    if(frameworkType(left)?.family==='vector'&&left===right){const name={'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','&':'BitwiseAnd','^':'Xor','==':'EqualsAll','!=':'EqualsAll'}[operator],contract=name&&findContracts('System.Numerics.Vector',name,true).find(d=>d.parameters[0]===left);if(contract){this.emitContract(contract);if(operator==='!=')this.emit(Op.UNARY,Unary['!']);return contract.result;}}
    let result;
    if(operator==='+'&&(left==='string'||right==='string'))result='string';
    else if(['==','!='].includes(operator)){if(!assignable(left,right)&&!assignable(right,left))this.c.report(node,'CS0019',`Operator '${operator}' cannot compare '${left}' and '${right}'`);result='bool';}
    else if(['&','|','^'].includes(operator)&&left==='bool'&&right==='bool')result='bool';
    else {if(!numeric(left)||!numeric(right))this.c.report(node,'CS0019',`Operator '${operator}' cannot be applied to '${left}' and '${right}'`);if(['&','|','^','<<','>>'].includes(operator)&&(left!=='int'||right!=='int'))this.c.report(node,'CS0019',`Operator '${operator}' requires integers`);result=['<','<=','>','>='].includes(operator)?'bool':left==='double'||right==='double'?'double':'int';}
    if(!(operator in Binary)){this.c.report(node,'SF2006',`Operator '${operator}' is not implemented`);this.emit(Op.POP);return 'error';}
    this.emit(Op.BINARY,Binary[operator],result==='int'?(this.overflowChecked(node)&&['+','-','*'].includes(operator)?5:1):result==='string'?2:result==='bool'&&left==='bool'?3:0);return result;
  }
  prepare(node,allowReadOnly=false){const framework=this.prepareFramework(node);if(framework)return framework;
    if(node.kind==='Name'){const l=this.lookup(node.name);if(l){if(l.isConst)this.c.report(node,'CS0131','A const local cannot be modified');if(l.isUsing)this.c.report(node,'CS1656','A using variable cannot be reassigned');if(l.isIteration)this.c.report(node,'CS1656','A foreach iteration variable cannot be reassigned');if(l.symbol)this.c.reference(node,l.symbol);return {kind:'local',...l};}}
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
    if(f){this.c.reference(node,f.symbol);if(f.isStatic)return {kind:'static',type:f.type,index:f.index};if(node.kind==='Member')this.expr(node.target);else{const self=this.lookup('this');if(!self)this.c.report(node,'CS0120','An object reference is required');this.emit(Op.LDLOC,self?.slot??0);}const receiver=this.temp(f.owner.name);this.emit(Op.STLOC,receiver);this.emit(Op.POP);return {kind:'field',type:f.type,index:f.index,receiver};}
    if(node.kind==='Index'){const type=this.expr(node.target),receiver=this.temp(type);this.emit(Op.STLOC,receiver);this.emit(Op.POP);this.checkAssign('int',this.expr(node.index),node.index);const index=this.temp('int');this.emit(Op.STLOC,index);this.emit(Op.POP);if(!type.endsWith('[]'))this.c.report(node,'CS0021','Array required');return {kind:'index',type:type.slice(0,-2),receiver,index};}
    this.c.report(node,'CS0131','The left-hand side must be a variable, field or array element');return {kind:'local',type:'error',slot:this.temp()};
  }
  loadRef(ref){if(ref.kind==='framework'){this.loadFramework(ref);return;}if(ref.kind==='property'){const getter=this.propertyAccess(ref.property,ref.node,'get');if(getter){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.CALL,getter.id,ref.property.isStatic?0:1);}else this.emitConstant(null);}else if(ref.kind==='local'){if(!this.assigned.has(ref.slot))this.c.report(this.m.node,'CS0165',`Use of unassigned local '${ref.name}'`);this.emit(Op.LDLOC,ref.slot);}else if(ref.kind==='static')this.emit(Op.LDSTATIC,ref.index);else{this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='field')this.emit(Op.LDFLD,ref.index);else{this.emit(Op.LDLOC,ref.index);this.emit(Op.LDELEM);}}}
  storeRef(ref){if(ref.kind==='framework'){this.storeFramework(ref);return;}if(ref.kind==='property'){const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);if(ref.property.set){if(!ref.property.isStatic)this.emit(Op.LDLOC,ref.receiver);this.emit(Op.LDLOC,value);this.emit(Op.CALL,ref.property.set.id,ref.property.isStatic?1:2);this.emit(Op.POP);}this.emit(Op.LDLOC,value);this.clear(value);if(ref.receiver!==null)this.clear(ref.receiver);}else if(ref.kind==='local'){this.emit(Op.STLOC,ref.slot);this.assigned.add(ref.slot);}else if(ref.kind==='static')this.emit(Op.STSTATIC,ref.index);else{const value=this.temp(ref.type);this.emit(Op.STLOC,value);this.emit(Op.POP);this.emit(Op.LDLOC,ref.receiver);if(ref.kind==='index')this.emit(Op.LDLOC,ref.index);this.emit(Op.LDLOC,value);this.emit(ref.kind==='field'?Op.STFLD:Op.STELEM,ref.kind==='field'?ref.index:0);this.clear(value);this.clear(ref.receiver);if(ref.kind==='index')this.clear(ref.index);}}
}
installFrameworkCompiler(MethodCompiler);
installModernCompiler(MethodCompiler);
export {languageVersion} from './modern.js';
function builtInRange(b){return `${b.min}–${b.max}`;}
export function compile(input,options={}){if(Array.isArray(input)&&input.length===0)input='';const files=typeof input==='string'?[parse(new SourceText(input))]:input.map(f=>f.root?f:parse(new SourceText(f.text,f.uri,f.version)));return new Compilation(files,options).build();}

/** Compile to the portable PE/CLI artifact without changing the lightweight IDE analysis API.
 * Errors are returned as diagnostics; image remains available only as a compiler/debugging IR.
 */
export function compileToIL(input,options={}) {
  const {framework='net8',embedSources=true,includeDebug=true,portablePdb=true,embeddedPdb=false,sourceLink=null,...compileOptions}=options;
  const result=compile(input,compileOptions);if(!result.success)return {...result,assembly:null,format:'cil'};
  try {const emitted=emitAssemblyDetailed(result.image,{name:compileOptions.name??result.image.name,framework,embedSources,includeDebug});const symbols=portablePdb?emitPortablePdb(emitted.bytes,emitted.symbolData,{embedSources,sourceLink}):null;const assembly=symbols?attachPortablePdb(emitted.bytes,symbols.bytes,{path:(compileOptions.name??result.image.name)+'.pdb',embedded:embeddedPdb}):emitted.bytes;return {...result,assembly,pdb:symbols?.bytes??null,format:'cil',metrics:{...result.metrics,...emitted.metrics,assemblyBytes:assembly.length,pdbBytes:symbols?.bytes.length??0}};}
  catch(error){if(!(error instanceof CilError)&&!(error instanceof SymbolError))throw error;const source=result.image.sources[0],d=diagnostic(new SourceText(source?.text??'',source?.uri??'Program.cs'),0,1,'SF3001',error.message);return {...result,success:false,image:null,assembly:null,format:'cil',diagnostics:[...result.diagnostics,d],metrics:{...result.metrics,errors:result.metrics.errors+1}};}
}
