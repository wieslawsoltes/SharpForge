import {DiagnosticId} from './diagnostics/codes.js';
import {languageVersion} from './modern.js';
import {collectDeclarations,declareField,declareProperty,declareMethod} from './declarations.js';
import {lowerAsyncFiles} from './async-lowering.js';
import {frameworkType} from '@sharpforge/framework';
import {diagnostic} from '@sharpforge/text';
import {Op,FORMAT_VERSION,serializeImage} from '@sharpforge/bytecode';
import {supported,normalize,defaultValue,typeText} from './type-utils.js';
import {formatMessage,defaultSeverity,featureNotAvailableCode} from './diagnostics/codes.js';
import {MethodCompiler} from './method-compiler.js';
import {BoundMethodPipeline} from './method-pipeline.js';
import {MethodIndex} from './method-index.js';
import {CompilationSymbols} from './symbols/compilation-symbols.js';
import {collectUsingDirectives,bindUsings} from './binder/usings.js';
import {findEntryPoint} from './binder/entry-point.js';
import {parseCompilationOptions} from './options.js';
import {applySuppression} from './diagnostics/suppression.js';
import {pragmaWarningsOf} from './diagnostics/pragma-trivia.js';
import {parserDiagnosticsWithoutSuppressMessage} from './diagnostics/suppress-message-attributes.js';
import {BuckStopsHereBinder,InContainerBinder,WithUsingsBinder} from './binder/binder.js';
import {NullableContextMap} from './nullable/annotations.js';
import {typeSyntaxSpan} from './binder/type-spans.js';
import {syntaxFeatureChecks} from './syntax-features.js';
import {reconcileWithSemanticAnalysis} from './semantic-integration.js';
import {declareTopLevelEntry,declareEntryStartup} from './codegen/entry-startup.js';
import {SourceSemanticModel} from './source-model.js';
export class Compilation {
  constructor(parsedFiles, options={}) {
    const syntaxChecks = syntaxFeatureChecks(parsedFiles, options);
    this.syntaxFeatureFailures = syntaxChecks.unavailable;
    this.syntaxFeatureDiagnostics = syntaxChecks.diagnostics;
    this.inputFiles=parsedFiles;parsedFiles=lowerAsyncFiles(parsedFiles);this.files=parsedFiles;this.options=options;this.sources=new Map(parsedFiles.map(p=>[p.source.uri,p.source]));
    this.diagnostics=parserDiagnosticsWithoutSuppressMessage(parsedFiles).filter(d=>!syntaxChecks.isSuperseded(d));for(const d of syntaxChecks.diagnostics)if(!this.diagnostics.some(existing=>existing.uri===d.uri&&existing.start===d.start&&existing.length===d.length&&existing.code===d.code&&existing.message===d.message))this.diagnostics.push(d);this.symbols=[];this.references=[];this.types=[];this.typeMap=new Map();this.methods=[];this.methodIndex=new MethodIndex();this.statics=[];this.constants=[];this.constantMap=new Map();this.sequencePoints=[];
    // 'bound' binds to a bound tree, analyses flow, lowers and then emits; 'legacy' is the fused string-typed method compiler.
    this.nullableMaps=new Map();this.fullNames=new Map();this.simpleNames=new Map();this.fileUsings=new Map();this.binderChains=new Map();this.pipeline=options.pipeline??globalThis.process?.env?.SHARPFORGE_PIPELINE??Compilation.defaultPipeline;this.semantic=new CompilationSymbols(this);this.boundPipeline=null;
  }
  static defaultPipeline='bound';
  /** Reuses the full source binder when compilation already needed it; otherwise binds lazily once. */
  getSourceModel(){return this.sourceModel??=new SourceSemanticModel(this);}
  /** Where code lives: `context` is a type record, a method record or null (the first file's global scope). */
  scopeOf(context){if(!context)return {namespace:'',uri:this.files[0]?.source.uri};if(context.declarations)return {namespace:context.namespace??'',uri:context.node.uri};return {namespace:context.owner?.namespace??'',uri:context.node?.uri??context.owner?.node.uri??this.files[0]?.source.uri};}
  /** The using directives of a file: `{namespaces:[dotted names], aliases:Map<alias,dotted name>}`. */
  usingsOf(uri){
    let usings=this.fileUsings.get(uri);if(usings)return usings;usings={namespaces:[],aliases:new Map()};const file=this.files.find(f=>f.source.uri===uri);
    if(file)for(const d of collectUsingDirectives(file)){if(d.kind==='namespace')usings.namespaces.push(d.name);else if(d.kind==='alias')usings.aliases.set(d.alias,d.name);}
    this.fileUsings.set(uri,usings);return usings;
  }
  /**
   * The binder chain outside a method body: usings of the file, the global namespace, the enclosing namespaces and
   * the containing type (BuckStopsHere <- WithUsings <- InContainer(global) <- InContainer(namespace)* <- InContainer(type)).
   * Unknown using namespaces are tolerated: the closed framework registry does not list every namespace.
   */
  containerBinder(context){
    const scope=this.scopeOf(context),key=scope.uri+'|'+scope.namespace;let chain=this.binderChains.get(key);
    if(!chain){
      const file=this.files.find(f=>f.source.uri===scope.uri),global=this.semantic.globalNamespace;
      const usings=bindUsings(file?collectUsingDirectives(file):[],{globalNamespace:global,reportMissing:false,bindType:name=>{const type=this.semantic.typeOf(this.typeName(name,context));return type&&!type.isErrorType()?type:null;}});
      chain=new InContainerBinder(global,new WithUsingsBinder(usings,new BuckStopsHereBinder(this)));let namespace=global;
      for(const part of scope.namespace?scope.namespace.split('.'):[]){namespace=namespace?.getNamespace(part);if(!namespace)break;chain=new InContainerBinder(namespace,chain);}
      this.binderChains.set(key,chain);
    }
    const owner=context?.declarations?context:context?.owner;return owner?new InContainerBinder(this.semantic.type(owner),chain):chain;
  }
  /**
   * Looks a user type up by simple or dotted name from `context`, in C# order: the enclosing namespaces innermost
   * first, then using aliases, then the namespaces imported by using directives. A simple name that only one type in
   * the compilation has is found without a using directive (the profile's leniency).
   * Returns `{type}`, `{ambiguous:[type,type,...]}` or null when no user type has that name.
   */
  lookupType(text,context=null){
    if(!text||!this.simpleNames.size)return null;const scope=this.scopeOf(context),parts=scope.namespace?scope.namespace.split('.'):[];
    for(let i=parts.length;i>=0;i--){const type=this.fullNames.get([...parts.slice(0,i),text].join('.'));if(type)return {type};}
    const usings=this.usingsOf(scope.uri),dot=text.indexOf('.'),head=dot<0?text:text.slice(0,dot);
    if(usings.aliases.has(head)){const type=this.fullNames.get(usings.aliases.get(head)+(dot<0?'':text.slice(dot)));if(type)return {type};}
    if(dot>=0)return null;
    const candidates=this.simpleNames.get(text);if(!candidates)return null;if(candidates.length===1)return {type:candidates[0]};
    const imported=candidates.filter(t=>usings.namespaces.includes(t.namespace));if(imported.length===1)return {type:imported[0]};
    return {ambiguous:imported.length?imported:candidates};
  }
  /** The declaration record of a user type named in source, as seen from `context`; null when unknown or ambiguous. */
  findType(name,context=null){return this.lookupType(name,context)?.type??null;}
  /** The image name a type-name text denotes, as seen from `context`: user types first, then the profile's built-in and framework names. */
  typeName(text,context=null){
    if(typeof text!=='string')return normalize(text);let base=text,suffix='';while(base.endsWith('[]')){base=base.slice(0,-2);suffix+='[]';}
    const found=this.lookupType(base,context);return found?.type?found.type.name+suffix:found?.ambiguous?found.ambiguous[0].name+suffix:normalize(text);
  }
  /** The nullable context (`{annotations,warnings}`) at a position of a file: `#nullable` directives over the `/nullable` default. */
  nullableContextAt(uri,position){let map=this.nullableMaps.get(uri);if(!map){const file=this.files.find(f=>f.source.uri===uri);map=new NullableContextMap(file?.directives??[],this.typedOptions?.nullableContext??this.options.nullableContext??this.options.nullable??'disable');this.nullableMaps.set(uri,map);}return map.stateAt(position);}
  /** The span of the type syntax that names `type` inside a declaration node (CS0246 and CS0104 are reported there); falls back to the node. */
  typeSpan(node,type){const file=this.files.find(f=>f.source.uri===node?.uri),span=file?.syntax&&typeof type==='string'?typeSyntaxSpan(file.syntax,node,type):null;return span?{uri:node.uri,start:span.start,end:span.end}:node;}
  /** Reports a catalog diagnostic: `args` fill the message format; severity defaults to the catalog severity. */
  report(node,code,args=[],severity=defaultSeverity(code)){if(this.diagnostics.length>=400)return;const source=this.sources.get(node.uri)??this.files[0]?.source;if(source)this.diagnostics.push(diagnostic(source,node.start??0,Math.max(1,(node.end??node.start+1)-node.start),code,formatMessage(code,args),severity));}
  /** True when a diagnostic with this code already covers the node start (one diagnostic per literal). */
  reportedAt(node,code){return this.diagnostics.some(d=>d.code===code&&d.uri===node.uri&&d.start===node.start);}
  /** The span of the first token of a syntax node (falls back to the node itself). */
  firstToken(node){const tokens=this.files.find(f=>f.source.uri===node.uri)?.tokens;if(!tokens)return node;let lo=0,hi=tokens.length-1;while(lo<hi){const mid=lo+hi>>1;if(tokens[mid].start<node.start)lo=mid+1;else hi=mid;}const t=tokens[lo];return t&&t.start===node.start&&t.end<=node.end?{uri:node.uri,start:t.start,end:t.end}:node;}
  /** The span of the last label of a switch section, from its case/default keyword through the colon. */
  caseLabelSpan(section){const tokens=this.files.find(f=>f.source.uri===section.uri)?.tokens,label=section.labels.at(-1);if(!tokens)return section;let end=-1;for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.start<section.start)continue;if(t.start>=section.end)break;if(t.kind===':'&&(label?t.start>=label.end:true)){end=i;break;}}if(end<0)return section;let start=end;while(start>0&&tokens[start].kind!==(label?'case':'default')&&tokens[start].start>section.start)start--;return {uri:section.uri,start:tokens[start].start,end:tokens[end].end};}
  selectedVersion(node){try{return languageVersion(this.options.langVersionByUri?.[node?.uri]??this.options.langVersion);}catch{return languageVersion();}}
  /** Source text of the last label of a switch section, as Roslyn prints it in CS0163/CS8070. */
  caseLabel(section){const label=section.labels.at(-1);if(!label)return 'default:';const text=this.sources.get(label.uri)?.text.slice(label.start,label.end);return `case ${text??''}:`;}
  requireFeature(node,version,name){let selected;try{selected=languageVersion(this.options.langVersionByUri?.[node.uri]??this.options.langVersion);}catch{return false;/* an invalid /langversion is reported once, with the options */}if(version===15?!selected.preview:selected.number<version){if(this.syntaxFeatureFailures.some(use=>use.uri===node.uri&&use.version===version&&use.start<(node.end??node.start+1)&&use.end>=(node.start??0)))return false;if(version===15)this.report(node,DiagnosticId.CS8652,[name]);else this.report(node,featureNotAvailableCode(selected.number),[name,Number.isInteger(version)?version+'.0':String(version)]);return false;}return true;}
  constant(value){const key=JSON.stringify([typeof value,value]);if(this.constantMap.has(key))return this.constantMap.get(key);const id=this.constants.length;this.constants.push(value);this.constantMap.set(key,id);return id;}
  symbol(node,kind,type,extra={}){
    if(node.generated||node.debugHidden)return null;
    const span=node.nameSpan??{start:node.start,end:node.end}, s={id:`${node.uri}:${span.start}:${kind}`,name:node.name,kind,type,uri:node.uri,start:span.start,end:span.end,...extra};this.symbols.push(s);this.reference(node,s,true);return s;
  }
  reference(node,symbol,declaration=false){if(!symbol||node.debugHidden)return;const span=node.nameSpan??{start:node.start,end:node.end};this.references.push({symbolId:symbol.id,uri:node.uri,start:span.start,end:span.end,declaration,type:symbol.type});}
  resolveType(type,node,allowVar=false,context=null){
    const written=type;
    if(typeof type==='string'){const ambiguous=this.lookupType(type.replace(/(\[\])+$/,''),context)?.ambiguous;if(ambiguous)this.report(this.typeSpan(node,written),DiagnosticId.CS0104,[type.replace(/(\[\])+$/,''),ambiguous[0].fullName,ambiguous[1].fullName]);}
    type=this.typeName(type,context);const element=type.endsWith('[]')?type.slice(0,-2):type;if(element==='var'&&allowVar)return type;if((!supported.has(element)&&!this.typeMap.has(element)&&!frameworkType(element))||element==='var')this.report(this.typeSpan(node,written),DiagnosticId.CS0246,[typeText(element)]);return type;}
  build(){
    if(this.pipeline==='verify')return verifyPipelines(this.inputFiles,this.options);
    const start=performance.now();
    // Options are validated once, up front (options.js): invalid values report the Roslyn codes.
    const parsed=parseCompilationOptions(this.options);this.typedOptions=parsed.options;for(const d of parsed.diagnostics)this.report(this.files[0]?.root??{},d.code,d.args);
    const tops=collectDeclarations(this);
    const library=this.options.outputKind==='library';
    // Entry point: top-level statements, else the one suitable static Main (binder/entry-point.js).
    const selection=findEntryPoint({methods:this.methods,topLevel:tops,isLibrary:library,mainTypeName:this.options.mainTypeName??null,types:this.types,root:this.files[0]?.root??{},asyncMainAvailable:node=>this.requireFeature(node,7.1,'async main')});
    for(const d of selection.diagnostics)this.report(d.node?.nameSpan?{uri:d.node.uri,start:d.node.nameSpan.start,end:d.node.nameSpan.end}:d.node,d.code,d.args);
    let entry=selection.method;
    if(selection.kind==='topLevel')entry=declareTopLevelEntry(this,selection.topLevel);
    // Per-type instance initializer routines execute before constructors.
    for(const type of this.types){
      const statements=type.fields.filter(f=>f.node.initializer&&!f.isStatic).map(f=>({kind:'ExpressionStatement',uri:f.node.uri,start:f.node.start,end:f.node.end,expression:{kind:'Assignment',operator:'=',left:{kind:'Member',target:{kind:'Name',name:'this',uri:f.node.uri,start:f.node.start,end:f.node.start},name:f.name,nameSpan:f.node.nameSpan,uri:f.node.uri,start:f.node.start,end:f.node.end},right:f.node.initializer,uri:f.node.uri,start:f.node.start,end:f.node.end}}));
      if(statements.length)type.initializer=this.declareMethod(type,{...type.node,kind:'Method',name:'<init>',returnType:'void',parameters:[],modifiers:[],body:{...type.node,kind:'Block',statements}},true).id;
    }
    const bound=this.pipeline==='bound'?new BoundMethodPipeline(this):null;this.boundPipeline=bound;
    for(const method of [...this.methods]){if(bound)bound.bindMethod(method);else new MethodCompiler(this,method).build();}
    // Library type initializers are real .cctor methods; the CLI has no entry-point token.
    if(library)for(const type of this.types){const fields=this.statics.filter(f=>f.owner===type&&f.node.initializer);if(!fields.length)continue;const node={...type.node,kind:'Method',name:'.cctor',parameters:[],returnType:'void',modifiers:['static'],body:{kind:'Block',statements:[],start:0,end:0,uri:type.node.uri}},method=this.declareMethod(type,node,true);if(bound){bound.bindInitializers(method,fields);continue;}const b=new MethodCompiler(this,method);for(const field of fields){const actual=b.typedExpr(field.node.initializer,field.type);b.checkAssign(field.type,actual,field.node);b.emit(Op.STSTATIC,field.index);b.emit(Op.POP);}b.emitConstant(null);b.emit(Op.RET);b.finish();}
    const entryId=entry?declareEntryStartup(this,entry,bound):library?null:0;
    if(bound)bound.emit();
    const image={formatVersion:FORMAT_VERSION,name:this.options.name??'Application',...(library?{outputKind:'library'}:{}),entryPoint:entryId,constants:this.constants,sequencePoints:this.sequencePoints,
      sources:this.files.map(f=>({uri:f.source.uri,text:f.source.text,version:f.source.version})),
      types:this.types.map(t=>({id:t.id,name:t.name,...(t.interfaces.length?{interfaces:t.interfaces}:{}),fields:t.fields.filter(f=>!f.isStatic).map(f=>({name:f.name,type:f.type,index:f.index,...(f.backing?{backing:true}:{} )})),...(t.properties.length?{properties:t.properties.map(p=>({name:p.name,type:p.type,isStatic:p.isStatic,access:p.access,get:p.get?.id??null,set:p.set?.id??null,backing:p.backing?.name??null}))}:{}),initializer:t.initializer})),
      statics:this.statics.map(f=>({name:`${f.owner.name}.${f.name}`,type:f.type,value:defaultValue(f.type),...(f.backing?{backing:true}:{} )})),
      methods:this.methods.map(m=>({...(m.node?.uri&&m.node.body&&(!m.node.asyncRole||m.node.asyncRole==='body')&&!m.name.startsWith('<startup>')?{sourceRange:{uri:m.node.uri,start:m.node.start,end:m.node.end}}:{}),...(m.node.asyncRole?{asyncRole:m.node.asyncRole,asyncOrigin:m.node.asyncOrigin}:{}),id:m.id,name:m.name,qualifiedName:m.qualifiedName,owner:m.owner?.name??null,isStatic:m.isStatic,returnType:m.returnType,...(m.accessor?{accessor:m.accessor}:{}),...(m.implementsDispose?{implementsDispose:true}:{}),parameters:m.parameters.map(p=>({name:p.name,type:p.type})),locals:m.locals??[],code:m.code??new Int32Array(),handlers:m.handlers??[]}))};
    // Warning options (#pragma warning, nowarn, warnaserror, warning level) decide the final diagnostic list.
    // Programs outside the execution profile get the diagnostics of the type system (semantic-integration.js).
    const reconciled=reconcileWithSemanticAnalysis(this,this.syntaxFeatureDiagnostics);if(reconciled){this.diagnostics=reconciled.diagnostics;this.semanticAnalysis=reconciled.semantic;}const finalImage=reconciled?.image??image;
    const pragmas=pragmaWarningsOf(this.inputFiles),diagnostics=applySuppression(pragmas.withoutParserDiagnostics(this.diagnostics),{sources:this.sources,pragmas:pragmas.byUri,includeDirectiveDiagnostics:true,options:this.typedOptions}),errors=diagnostics.filter(d=>d.severity==='error').length;
    return {success:errors===0,image:errors===0?finalImage:null,diagnostics,symbols:this.symbols,references:this.references,...(this.semanticAnalysis?{semantic:{analysed:true,complete:!this.semanticAnalysis.incomplete,...(reconciled?.image?{generated:true}:{})}}:{}),
      metrics:{compileMs:performance.now()-start,files:this.files.length,tokens:this.files.reduce((s,f)=>s+f.tokens.length,0),internedTokenHits:this.files.reduce((s,f)=>s+f.internedTokenHits,0),nodes:this.files.reduce((s,f)=>s+f.nodeCount,0),methods:this.methods.length,instructions:this.methods.reduce((s,m)=>s+(m.code?.length??0)/3,0),errors}};
  }
  declareField(owner,node){return declareField(this,owner,node);}
  declareProperty(owner,node){return declareProperty(this,owner,node);}
  declareMethod(owner,node,synthetic=false){return declareMethod(this,owner,node,synthetic);}
}
/**
 * Pipeline verification (`pipeline:'verify'` or SHARPFORGE_PIPELINE=verify): compiles with the legacy method compiler
 * and with the bound pipeline and checks that they agree. Returns the legacy result.
 *
 * Required: the same success, a byte-identical image, the same diagnostics apart from flow analysis, and the same
 * IDE symbols and references. Tolerated: the flow diagnostics (CS0161, CS0162, CS0163, CS0165, CS0168, CS0219, CS8070),
 * where the bound pipeline follows Roslyn's reachability and definite-assignment rules instead of the legacy
 * approximation, and the IDE symbol the legacy compiler published for a spread temporary.
 * A violation is thrown, or passed to `globalThis.SHARPFORGE_PIPELINE_MISMATCH` when that hook is set.
 */
const flowCodes=new Set([DiagnosticId.CS0161,DiagnosticId.CS0162,DiagnosticId.CS0163,DiagnosticId.CS0165,DiagnosticId.CS0168,DiagnosticId.CS0219,DiagnosticId.CS8070]);
function verifyPipelines(files,options){
  const sources=files.map(f=>({uri:f.source.uri,text:f.source.text})),fail=mismatch=>{if(globalThis.SHARPFORGE_PIPELINE_MISMATCH)globalThis.SHARPFORGE_PIPELINE_MISMATCH(mismatch);else throw new Error('Pipeline mismatch: '+JSON.stringify({crash:mismatch.crash,success:mismatch.success,imageEqual:mismatch.imageEqual,onlyLegacy:mismatch.onlyLegacy,onlyBound:mismatch.onlyBound,symbols:mismatch.symbols,references:mismatch.references}));};
  const legacy=new Compilation(files,{...options,pipeline:'legacy'}).build();let bound;
  try{bound=new Compilation(files,{...options,pipeline:'bound'}).build();}catch(error){fail({crash:error.stack,success:[legacy.success,null],sources,options,legacy,onlyLegacy:[],onlyBound:[]});return legacy;}
  const key=d=>[d.code,d.uri,d.start,d.length,d.severity,d.message].join('|'),count=list=>{const m=new Map();for(const d of list)m.set(key(d),(m.get(key(d))??0)+1);return m;},a=count(legacy.diagnostics),b=count(bound.diagnostics);
  const onlyLegacy=[...a].filter(([k,n])=>(b.get(k)??0)<n).map(([k])=>k),onlyBound=[...b].filter(([k,n])=>(a.get(k)??0)<n).map(([k])=>k),isFlow=k=>flowCodes.has(k.slice(0,6));
  // An image generated from the semantic bound trees is not a product of either pipeline: there is nothing to compare.
  const generated=legacy.semantic?.generated||bound.semantic?.generated;
  const image=legacy.success&&bound.success&&!generated?serializeImage(legacy.image)===serializeImage(bound.image):null;
  const spread=new Set(legacy.symbols.filter(x=>x.name.startsWith('$spread')).map(x=>x.id)),symbols=JSON.stringify(legacy.symbols.filter(x=>!spread.has(x.id)))===JSON.stringify(bound.symbols),references=JSON.stringify(legacy.references.filter(r=>!spread.has(r.symbolId)))===JSON.stringify(bound.references);
  const flowOnly=onlyLegacy.every(isFlow)&&onlyBound.every(isFlow),successOk=legacy.success===bound.success||flowOnly&&(onlyLegacy.length>0||onlyBound.length>0);
  const mismatch={success:[legacy.success,bound.success],imageEqual:image,onlyLegacy,onlyBound,symbols,references,sources,options,legacy,bound,tolerated:successOk&&image!==false&&flowOnly&&symbols&&references};
  if(!mismatch.tolerated)fail(mismatch);else if(globalThis.SHARPFORGE_PIPELINE_MISMATCH&&(onlyLegacy.length||onlyBound.length))globalThis.SHARPFORGE_PIPELINE_MISMATCH(mismatch);
  return legacy;
}
