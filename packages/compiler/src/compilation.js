import {languageVersion,hasBackingField,rewriteBackingField} from './modern.js';
import {lowerAsyncFiles} from './async-lowering.js';
import {frameworkType,taskResult,findContracts} from '@sharpforge/framework';
import {diagnostic} from '@sharpforge/text';
import {Op,frameworkBuiltin,FORMAT_VERSION} from '@sharpforge/bytecode';
import {supported,normalize,defaultValue,typeText} from './type-utils.js';
import {formatMessage,defaultSeverity,featureNotAvailableCode} from './diagnostics/codes.js';
import {MethodCompiler} from './method-compiler.js';
export class Compilation {
  constructor(parsedFiles, options={}) {
    parsedFiles=lowerAsyncFiles(parsedFiles);this.files=parsedFiles;this.options=options;this.sources=new Map(parsedFiles.map(p=>[p.source.uri,p.source]));
    this.diagnostics=parsedFiles.flatMap(p=>p.diagnostics);this.symbols=[];this.references=[];this.types=[];this.typeMap=new Map();this.methods=[];this.statics=[];this.constants=[];this.constantMap=new Map();this.sequencePoints=[];
  }
  /** Reports a catalog diagnostic: `args` fill the message format; severity defaults to the catalog severity. */
  report(node,code,args=[],severity=defaultSeverity(code)){if(this.diagnostics.length>=400)return;const source=this.sources.get(node.uri)??this.files[0]?.source;if(source)this.diagnostics.push(diagnostic(source,node.start??0,Math.max(1,(node.end??node.start+1)-node.start),code,formatMessage(code,args),severity));}
  /** True when a diagnostic with this code already covers the node start (one diagnostic per literal). */
  reportedAt(node,code){return this.diagnostics.some(d=>d.code===code&&d.uri===node.uri&&d.start===node.start);}
  selectedVersion(node){try{return languageVersion(this.options.langVersionByUri?.[node?.uri]??this.options.langVersion);}catch{return languageVersion();}}
  /** Source text of the last label of a switch section, as Roslyn prints it in CS0163/CS8070. */
  caseLabel(section){const label=section.labels.at(-1);if(!label)return 'default:';const text=this.sources.get(label.uri)?.text.slice(label.start,label.end);return `case ${text??''}:`;}
  requireFeature(node,version,name){let selected;try{selected=languageVersion(this.options.langVersionByUri?.[node.uri]??this.options.langVersion);}catch(error){this.report(node,'SF2140',[this.options.langVersionByUri?.[node.uri]??this.options.langVersion]);return false;}if(version===15?!selected.preview:selected.number<version){if(version===15)this.report(node,'CS8652',[name]);else this.report(node,featureNotAvailableCode(selected.number),[name,Number.isInteger(version)?version+'.0':String(version)]);return false;}return true;}
  constant(value){const key=JSON.stringify([typeof value,value]);if(this.constantMap.has(key))return this.constantMap.get(key);const id=this.constants.length;this.constants.push(value);this.constantMap.set(key,id);return id;}
  symbol(node,kind,type,extra={}){
    if(node.generated||node.debugHidden)return null;
    const span=node.nameSpan??{start:node.start,end:node.end}, s={id:`${node.uri}:${span.start}:${kind}`,name:node.name,kind,type,uri:node.uri,start:span.start,end:span.end,...extra};this.symbols.push(s);this.reference(node,s,true);return s;
  }
  reference(node,symbol,declaration=false){if(!symbol||node.debugHidden)return;const span=node.nameSpan??{start:node.start,end:node.end};this.references.push({symbolId:symbol.id,uri:node.uri,start:span.start,end:span.end,declaration,type:symbol.type});}
  resolveType(type,node,allowVar=false){type=normalize(type);const element=type.endsWith('[]')?type.slice(0,-2):type;if(element==='var'&&allowVar)return type;if((!supported.has(element)&&!this.typeMap.has(element)&&!frameworkType(element))||element==='var')this.report(node,'CS0246',[typeText(type)]);return type;}
  build(){
    const start=performance.now();try{languageVersion(this.options.langVersion);for(const value of Object.values(this.options.langVersionByUri??{}))languageVersion(value);}catch(error){this.report(this.files[0]?.root??{},'SF2140',[error.value]);}if(this.options.checkOverflow!==undefined&&typeof this.options.checkOverflow!=='boolean'||Object.values(this.options.checkOverflowByUri??{}).some(v=>typeof v!=='boolean'))this.report(this.files[0]?.root??{},'SF2009',['checkOverflow']);
    // Two-pass declarations allow forward calls and references across source files.
    for(const file of this.files)for(const decl of file.root.members.filter(n=>n.kind==='Class')){
      if(this.typeMap.has(decl.name)){
        const existing=this.typeMap.get(decl.name);
        if((existing.node.namespace??'')!==(decl.namespace??'')){this.report(decl,'SF2011',[decl.name]);continue;}
        if(!decl.modifiers.includes('partial')||!existing.declarations.every(d=>d.modifiers.includes('partial'))){this.report(decl,existing.declarations.some(d=>d.modifiers.includes('partial'))||decl.modifiers.includes('partial')?'CS0260':'CS0101',[decl.name,decl.namespace||'<global namespace>']);continue;}
        const access=d=>d.modifiers.filter(m=>['public','internal','private','protected'].includes(m)).sort().join(' '),specified=existing.declarations.map(access).filter(Boolean);
        if(access(decl)&&specified.some(a=>a!==access(decl)))this.report(decl,'CS0262',[decl.name]);
        existing.declarations.push(decl);this.reference(decl,existing.symbol,true);continue;
      }
      const type={id:this.types.length,name:decl.name,fields:[],properties:[],methods:[],interfaces:[],node:decl,declarations:[decl]};type.symbol=this.symbol(decl,'class',decl.name);this.types.push(type);this.typeMap.set(type.name,type);
    }
    for(const type of this.types){for(const member of type.declarations.flatMap(d=>d.members)){if(member.kind==='Field')this.declareField(type,member);else if(member.kind==='Property')this.declareProperty(type,member);else this.declareMethod(type,member,!!member.generated);}}
    for(const type of this.types){type.interfaces=[...new Set(type.declarations.flatMap(d=>d.interfaces??[]))];if(type.interfaces.includes('System.IDisposable')){const method=type.methods.find(m=>m.name==='Dispose'&&!m.isStatic&&m.parameters.length===0&&m.returnType==='void'&&m.node.modifiers.includes('public'));if(!method)this.report(type.node,'CS0535',[type.name,'System.IDisposable.Dispose()']);else method.implementsDispose=true;}}
    const tops=[];
    for(const file of this.files){
      for(const node of file.root.members.filter(n=>n.kind==='Method'))this.declareMethod(null,{...node,modifiers:[...node.modifiers,'static']});
      if(file.root.statements.length)tops.push({file,statements:file.root.statements});
    }
    if(tops.length>1)this.report(tops[1].file.root,'CS8802');
    const library=this.options.outputKind==='library';if(!['exe','library'].includes(this.options.outputKind??'exe'))this.report(this.files[0]?.root??{},'SF2008',[this.options.outputKind]);
    if(library&&tops.length)this.report(tops[0].file.root,'CS8805');
    let entry;
    if(!library&&tops.length){const {file,statements}=tops[0];entry=this.declareMethod(null,{kind:'Method',name:'<Main>',returnType:'void',parameters:[],modifiers:['static'],body:{kind:'Block',statements,start:0,end:file.source.length,uri:file.source.uri},uri:file.source.uri,start:0,end:file.source.length});}
    else if(!library){const candidates=this.methods.filter(m=>m.name==='Main'&&m.isStatic);entry=candidates[0];if(candidates.length>1)this.report(candidates[1].node,'CS0017');}
    if(!library&&!entry)this.report(this.files[0]?.root??{},'CS5001');
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
      if(entry.node.asyncRole==='kickoff'&&entry.returnType==='void')this.report(entry.node,'CS4009');
      if(!['void','int'].includes(entry.returnType)&&!['void','int'].includes(taskResult(entry.returnType)))this.report(entry.node,'CS0028',[entry.qualifiedName],'error');
      if(entry.parameters.length>1||entry.parameters.length===1&&entry.parameters[0].type!=='string[]')this.report(entry.node,'CS0028',[entry.qualifiedName],'error');
      const node={...entry.node,name:'<startup>',parameters:[],returnType:taskResult(entry.returnType)??entry.returnType,modifiers:['static'],body:{kind:'Block',statements:[],start:0,end:0,uri:entry.node.uri}};
      const startup=this.declareMethod(null,node,true), b=new MethodCompiler(this,startup);
      for(const field of this.statics){if(field.node.initializer){b.m.owner=field.owner;const type=b.typedExpr(field.node.initializer,field.type);b.checkAssign(field.type,type,field.node);b.emit(Op.STSTATIC,field.index);b.emit(Op.POP);}} b.m.owner=null;
      if(entry.parameters.length){b.emitConstant(0);b.emit(Op.NEWARR,this.constant('string'));}
      b.emit(Op.CALL,entry.id,entry.parameters.length);if(taskResult(entry.returnType)!==null){const d=findContracts('SharpForge.Runtime.Async','Await',true).find(x=>x.parameters[0]===entry.returnType),builtin=d?frameworkBuiltin(d):null;if(builtin)b.emit(Op.BUILTIN,builtin.id,1);else{this.report(entry.node,'CS0028',[entry.qualifiedName],'error');b.emit(Op.POP);b.emitConstant(null);}}b.emit(Op.RET);b.finish();entryId=startup.id;
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
    if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name))this.report(node,'CS0102',[owner.name,node.name]);
    if(node.modifiers.includes('readonly')||node.modifiers.includes('const'))this.report(node,'SF2001');
    if(node.modifiers.includes('partial'))this.report(node,'SF2010');
    const field={name:node.name,type,isStatic,index:isStatic?this.statics.length:owner.fields.filter(f=>!f.isStatic).length,node,owner};field.backing=!!node.backing;field.symbol=node.backing?null:this.symbol(node,'field',type,{owner:owner.name,isStatic});owner.fields.push(field);if(isStatic)this.statics.push(field);return field;
  }
  declareProperty(owner,node){
    const type=this.resolveType(node.type,node),isStatic=node.modifiers.includes('static'),access=node.modifiers.find(m=>['public','private','internal','protected'].includes(m))??'private';
    if(['void','var'].includes(type))this.report(node,'CS0547',[owner.name+'.'+node.name]);
    if(node.modifiers.some(m=>['const','readonly','partial'].includes(m)))this.report(node,'CS0106',[node.modifiers.find(m=>['const','readonly','partial'].includes(m))]);
    if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name)||owner.methods.some(m=>m.name===node.name))this.report(node,'CS0102',[owner.name,node.name]);
    if(!node.accessors.length)this.report(node,'CS0548',[owner.name+'.'+node.name]);
    if(node.accessors.filter(a=>a.modifiers.length).length>1)this.report(node,'CS0274',[owner.name+'.'+node.name]);
    const property={name:node.name,type,isStatic,access,node,owner,get:null,set:null,backing:null};owner.properties.push(property);
    property.symbol=this.symbol(node,'property',type,{owner:owner.name,isStatic,access,readable:node.accessors.some(a=>a.name==='get'),writable:node.accessors.some(a=>a.name==='set')});
    const auto=node.accessors.some(a=>!a.body),fieldBacked=node.accessors.some(a=>hasBackingField(a.body)),mixed=auto&&node.accessors.some(a=>a.body),backed=auto||fieldBacked;
    if(fieldBacked||mixed)this.requireFeature(node,14,'Field-backed properties');
    if(auto&&!fieldBacked&&!node.accessors.some(a=>a.name==='get'))this.report(node,'CS8051');
    if(node.initializer&&!backed)this.report(node,'CS8050');
    if(backed)property.backing=this.declareField(owner,{...node,kind:'Field',name:`<${node.name}>k__BackingField`,backing:true,modifiers:isStatic?['static']:[],initializer:node.initializer});
    for(const accessor of node.accessors){
      if(!['get','set'].includes(accessor.name))continue;
      if(property[accessor.name]){this.report(accessor,'CS1007');continue;}
      const specified=accessor.modifiers.filter(m=>['private','internal','protected','public'].includes(m));
      if(accessor.modifiers.length!==specified.length||specified.length>1)this.report(accessor,'CS0106',[accessor.modifiers.find(m=>!['private','internal','protected','public'].includes(m))??accessor.modifiers[1]]);
      const visibility=specified[0]??access;
      if(specified.length&&(node.accessors.length!==2||visibility===access||visibility==='public'||access==='private'||access==='internal'&&visibility!=='private'||access==='protected'&&visibility!=='private'))this.report(accessor,'CS0273',[owner.name+'.'+node.name+'.'+accessor.name,owner.name+'.'+node.name]);
      let body=fieldBacked?rewriteBackingField(accessor.body,property.backing.name,n=>this.report(n,'CS9273',[this.selectedVersion(n).name])):accessor.body;
      if(!body){const field={...node,kind:'Name',name:property.backing.name};const expression=accessor.name==='get'?field:{...node,kind:'Assignment',operator:'=',left:field,right:{...accessor,kind:'Name',name:'value'}};
        body={...accessor,kind:'Block',statements:[{...accessor,kind:accessor.name==='get'?'Return':'ExpressionStatement',expression}]};}
      const method=this.declareMethod(owner,{...node,kind:'Method',name:accessor.name+'_'+node.name,returnType:accessor.name==='get'?type:'void',parameters:accessor.name==='get'?[]:[{...accessor,kind:'Parameter',name:'value',type}],modifiers:isStatic?['static']:[],body},true);
      method.accessor={property:node.name,kind:accessor.name,access:visibility};property[accessor.name]=method;
    }
    return property;
  }
  declareMethod(owner,node,synthetic=false){
    if(!synthetic&&owner?.properties.some(p=>p.name===node.name))this.report(node,'CS0102',[owner.name,node.name]);
    if(!synthetic&&node.modifiers.includes('partial'))this.report(node,'SF2010');
    const parameters=node.parameters.map(p=>({...p,type:this.resolveType(p.type,p)})),returnType=this.resolveType(node.returnType,node),isStatic=node.modifiers.includes('static')||!owner;
    const method={id:this.methods.length,name:node.name,qualifiedName:(owner?owner.name+'.':'')+node.name,returnType,parameters,isStatic,owner,node,synthetic};
    if(this.methods.some(m=>m.owner===owner&&m.name===method.name&&m.parameters.map(p=>p.type).join(',')===parameters.map(p=>p.type).join(',')))this.report(node,'CS0111',[node.name,owner?.name??'<top-level>']);
    if(!synthetic)method.symbol=this.symbol(node,'method',returnType,{owner:owner?.name,isStatic,bodyStart:node.start,bodyEnd:node.end,parameters:parameters.map(p=>({name:p.name,type:p.type}))});this.methods.push(method);owner?.methods.push(method);return method;
  }
}
