import {DiagnosticId} from './diagnostics/codes.js';
import {reportFieldKeywordUses} from './binder/field-keyword.js';

/** Collect source types before members so declarations can refer forward across files. */
export function collectDeclarations(compilation){
  // Two-pass declarations allow forward calls and references across source files.
  for(const file of compilation.files)for(const decl of file.root.members.filter(n=>n.kind==='Class')){
    const namespace=decl.namespace??'',fullName=(namespace?namespace+'.':'')+decl.name;
    if(compilation.fullNames.has(fullName)){
      const existing=compilation.fullNames.get(fullName);
      if(!decl.modifiers.includes('partial')||!existing.declarations.every(d=>d.modifiers.includes('partial'))){compilation.report(decl,existing.declarations.some(d=>d.modifiers.includes('partial'))||decl.modifiers.includes('partial')?DiagnosticId.CS0260:DiagnosticId.CS0101,[decl.name,decl.namespace||'<global namespace>']);continue;}
      const access=d=>d.modifiers.filter(m=>['public','internal','private','protected'].includes(m)).sort().join(' '),specified=existing.declarations.map(access).filter(Boolean);
      if(access(decl)&&specified.some(a=>a!==access(decl)))compilation.report(decl,DiagnosticId.CS0262,[decl.name]);
      existing.declarations.push(decl);compilation.reference(decl,existing.symbol,true);continue;
    }
    const type={id:compilation.types.length,name:decl.name,namespace,fullName,fields:[],properties:[],methods:[],interfaces:[],node:decl,declarations:[decl]};type.symbol=compilation.symbol(decl,'class',decl.name);compilation.types.push(type);compilation.fullNames.set(fullName,type);
  }
  // A type is identified by its namespace path. Its image name stays the simple name while that is unique in the
  // compilation and becomes the namespace-qualified name when two namespaces declare the same simple name.
  for(const type of compilation.types){const list=compilation.simpleNames.get(type.node.name);if(list)list.push(type);else compilation.simpleNames.set(type.node.name,[type]);}
  for(const type of compilation.types){if(compilation.simpleNames.get(type.node.name).length>1)type.name=type.fullName;compilation.typeMap.set(type.name,type);}
  for(const type of compilation.types)compilation.semantic.type(type);
  for(const type of compilation.types){for(const member of type.declarations.flatMap(d=>d.members)){if(member.kind==='Field')compilation.declareField(type,member);else if(member.kind==='Property')compilation.declareProperty(type,member);else compilation.declareMethod(type,member,!!member.generated);}}
  for(const type of compilation.types){type.interfaces=[...new Set(type.declarations.flatMap(d=>d.interfaces??[]))];if(type.interfaces.includes('System.IDisposable')){const method=type.methods.find(m=>m.name==='Dispose'&&!m.isStatic&&m.parameters.length===0&&m.returnType==='void'&&m.node.modifiers.includes('public'));if(!method)compilation.report(type.node,DiagnosticId.CS0535,[type.name,'System.IDisposable.Dispose()']);else method.implementsDispose=true;}}
  const tops=[];
  for(const file of compilation.files){
    for(const node of file.root.members.filter(n=>n.kind==='Method'))compilation.declareMethod(null,{...node,modifiers:[...node.modifiers,'static']});
    // A local function is a statement too: a file of local functions alone is a program that does nothing.
    if(file.root.statements.length||file.root.members.some(n=>n.kind==='Method'))tops.push({file,statements:file.root.statements});
  }
  return tops;
}

export function declareField(compilation,owner,node){const type=compilation.resolveType(node.type,node,false,owner),isStatic=node.modifiers.includes('static')||node.modifiers.includes('const');
  if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name))compilation.report(node,DiagnosticId.CS0102,[owner.name,node.name]);
  if(node.modifiers.includes('readonly')||node.modifiers.includes('const'))compilation.report(node,DiagnosticId.SF2001);
  if(node.modifiers.includes('partial'))compilation.report(node,DiagnosticId.SF2010);
  const field={name:node.name,type,isStatic,index:isStatic?compilation.statics.length:owner.fields.filter(f=>!f.isStatic).length,node,owner};field.backing=!!node.backing;field.symbol=node.backing?null:compilation.symbol(node,'field',type,{owner:owner.name,isStatic});owner.fields.push(field);if(isStatic)compilation.statics.push(field);return field;
}
export function declareProperty(compilation,owner,node){
  const type=compilation.resolveType(node.type,node,false,owner),isStatic=node.modifiers.includes('static'),access=node.modifiers.find(m=>['public','private','internal','protected'].includes(m))??'private';
  if(['void','var'].includes(type))compilation.report(node,DiagnosticId.CS0547,[owner.name+'.'+node.name]);
  if(node.modifiers.some(m=>['const','readonly','partial'].includes(m)))compilation.report(node,DiagnosticId.CS0106,[node.modifiers.find(m=>['const','readonly','partial'].includes(m))]);
  if(owner.fields.some(f=>f.name===node.name)||owner.properties.some(p=>p.name===node.name)||owner.methods.some(m=>m.name===node.name))compilation.report(node,DiagnosticId.CS0102,[owner.name,node.name]);
  if(!node.accessors.length)compilation.report(node,DiagnosticId.CS0548,[owner.name+'.'+node.name]);
  if(node.accessors.filter(a=>a.modifiers.length).length>1)compilation.report(node,DiagnosticId.CS0274,[owner.name+'.'+node.name]);
  const property={name:node.name,type,isStatic,access,node,owner,get:null,set:null,backing:null};owner.properties.push(property);
  property.symbol=compilation.symbol(node,'property',type,{owner:owner.name,isStatic,access,readable:node.accessors.some(a=>a.name==='get'),writable:node.accessors.some(a=>a.name==='set')});
  const fieldBacked=reportFieldKeywordUses(node,compilation.selectedVersion(node),(at,code,args)=>compilation.report(at,code,args));
  const auto=node.accessors.some(a=>!a.body),mixed=auto&&node.accessors.some(a=>a.body),backed=auto||fieldBacked;
  if(mixed)compilation.requireFeature(node.nameSpan?{...node,...node.nameSpan}:node,14,'field keyword');
  if(auto&&!fieldBacked&&!node.accessors.some(a=>a.name==='get'))compilation.report(node,DiagnosticId.CS8051);
  if(node.initializer&&!backed)compilation.report(node,DiagnosticId.CS8050);
  if(backed)property.backing=compilation.declareField(owner,{...node,kind:'Field',name:`<${node.name}>k__BackingField`,backing:true,modifiers:isStatic?['static']:[],initializer:node.initializer});
  for(const accessor of node.accessors){
    if(!['get','set'].includes(accessor.name))continue;
    if(property[accessor.name]){compilation.report(accessor,DiagnosticId.CS1007);continue;}
    const specified=accessor.modifiers.filter(m=>['private','internal','protected','public'].includes(m));
    if(accessor.modifiers.length!==specified.length||specified.length>1)compilation.report(accessor,DiagnosticId.CS0106,[accessor.modifiers.find(m=>!['private','internal','protected','public'].includes(m))??accessor.modifiers[1]]);
    const visibility=specified[0]??access;
    if(specified.length&&(node.accessors.length!==2||visibility===access||visibility==='public'||access==='private'||access==='internal'&&visibility!=='private'||access==='protected'&&visibility!=='private'))compilation.report(accessor,DiagnosticId.CS0273,[owner.name+'.'+node.name+'.'+accessor.name,owner.name+'.'+node.name]);
    let body=fieldBacked?null:accessor.body;
    if(!body){const field={...node,kind:'Name',name:property.backing.name};const expression=accessor.name==='get'?field:{...node,kind:'Assignment',operator:'=',left:field,right:{...accessor,kind:'Name',name:'value'}};
      body={...accessor,kind:'Block',statements:[{...accessor,kind:accessor.name==='get'?'Return':'ExpressionStatement',expression}]};}
    const method=compilation.declareMethod(owner,{...node,kind:'Method',name:accessor.name+'_'+node.name,returnType:accessor.name==='get'?type:'void',parameters:accessor.name==='get'?[]:[{...accessor,kind:'Parameter',name:'value',type}],modifiers:isStatic?['static']:[],body},true);
    method.accessor={property:node.name,kind:accessor.name,access:visibility};property[accessor.name]=method;
  }
  return property;
}
export function declareMethod(compilation,owner,node,synthetic=false){
  if(!synthetic&&owner?.properties.some(p=>p.name===node.name))compilation.report(node,DiagnosticId.CS0102,[owner.name,node.name]);
  if(!synthetic&&node.modifiers.includes('partial'))compilation.report(node,DiagnosticId.SF2010);
  if(!synthetic&&node.name==='.ctor'&&node.modifiers.includes('static'))compilation.report(node,DiagnosticId.SF2014);
  const scope=owner??{owner:null,node},parameters=node.parameters.map(p=>({...p,type:compilation.resolveType(p.type,p,false,scope)})),returnType=compilation.resolveType(node.returnType,node,false,scope),isStatic=node.modifiers.includes('static')||!owner;
  const method={id:compilation.methods.length,name:node.name,qualifiedName:(owner?owner.name+'.':'')+node.name,returnType,parameters,isStatic,owner,node,synthetic};
  if(compilation.methodIndex.hasSignature(method))compilation.report(node,DiagnosticId.CS0111,[node.name,owner?.name??'<top-level>']);
  if(!synthetic)method.symbol=compilation.symbol(node,'method',returnType,{owner:owner?.name,isStatic,bodyStart:node.start,bodyEnd:node.end,parameters:parameters.map(p=>({name:p.name,type:p.type}))});compilation.methods.push(method);compilation.methodIndex.add(method);owner?.methods.push(method);return method;
}
