import { SourceText, diagnostic } from '@sharpforge/text';
import { keywords } from '@sharpforge/syntax';
const identifier = name => typeof name==='string'&&/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)&&!keywords.has(name);
function cancelled(signal){if(signal?.aborted)throw new DOMException('Extension operation cancelled','AbortError');}
function synchronous(result){if(result&&typeof result.then==='function')throw new TypeError('Extension callbacks must be synchronous');}
export function* syntaxNodes(root){const stack=[root];while(stack.length){const n=stack.pop();if(!n||typeof n!=='object')continue;if(typeof n.kind==='string')yield n;for(const [key,value] of Object.entries(n)){if(['source','tokens','green','nameSpan'].includes(key))continue;if(Array.isArray(value)){for(let i=value.length-1;i>=0;i--)if(value[i]&&typeof value[i]==='object')stack.push(value[i]);}else if(value&&typeof value==='object')stack.push(value);}}}
/** Host-trusted synchronous extensions. Output limits are not a sandbox or CPU preemption. */
export class ExtensionDriver {
  constructor({maxGeneratedFiles=100,maxGeneratedCharacters=2_000_000,maxDiagnostics=1000}={}){this.generators=new Map();this.analyzers=new Map();this.revision=0;this.cache=new Map();this.analysisCache=new WeakMap();this.maxGeneratedFiles=maxGeneratedFiles;this.maxGeneratedCharacters=maxGeneratedCharacters;this.maxDiagnostics=maxDiagnostics;this.metrics={generatorRuns:0,generatorCacheHits:0,analyzerRuns:0};}
  registerGenerator(extension){return this.register(this.generators,extension,'generate');}
  registerAnalyzer(extension){return this.register(this.analyzers,extension,'analyze');}
  register(map,extension,callback){if(!extension||!identifier(extension.id)||typeof extension[callback]!=='function')throw new TypeError('An identifier and synchronous extension callback are required');if(map.has(extension.id))throw new Error(`Duplicate extension '${extension.id}'`);map.set(extension.id,Object.freeze({...extension}));this.revision++;this.cache.clear();this.analysisCache=new WeakMap();return this;}
  remove(id){const removed=this.generators.delete(id)|this.analyzers.delete(id);if(removed){this.revision++;this.cache.clear();this.analysisCache=new WeakMap();}return !!removed;}
  generate(sources,{additionalFiles=[],options={},signal}={}){
    cancelled(signal);const snapshots=Object.freeze(sources.map(s=>Object.freeze({uri:s.uri,text:s.text,version:s.version}))),additional=Object.freeze(additionalFiles.map(s=>Object.freeze({uri:s.uri,text:s.text})));const key=JSON.stringify([snapshots,additional,options]);let chars=0;const files=[],diagnostics=[];
    for(const [id,generator] of this.generators){cancelled(signal);let value=this.cache.get(id);if(value?.key===key){this.metrics.generatorCacheHits++;}else{
      const generated=[],reported=[];let length=0;const addSource=(hint,text)=>{if(typeof hint!=='string'||!/^[-A-Za-z0-9_./]+\.cs$/.test(hint)||hint.split('/').some(x=>!x||x==='.'||x==='..')||typeof text!=='string')throw new Error('Invalid generated source name or text');const uri=`generated://${id}/${hint}`;if(generated.some(s=>s.uri===uri))throw new Error(`Duplicate generated source '${hint}'`);length+=text.length;if(generated.length>=this.maxGeneratedFiles||length>this.maxGeneratedCharacters)throw new RangeError('Generated source budget exceeded');generated.push(Object.freeze({uri,text,version:1,generated:true,generator:id}));};
      try{this.metrics.generatorRuns++;synchronous(generator.generate(Object.freeze({sources:snapshots,additionalFiles:additional,options:Object.freeze({...options}),signal,addSource,reportDiagnostic:d=>{if(reported.length<this.maxDiagnostics)reported.push({...d});}})));cancelled(signal);}
      catch(error){if(signal?.aborted)throw error;generated.length=0;reported.push({code:'SFGEN001',message:`Generator ${id}: ${error.message}`,severity:'error'});}
      value={key,files:Object.freeze(generated),diagnostics:Object.freeze(reported)};this.cache.set(id,value);
    }
    for(const file of value.files){chars+=file.text.length;if(files.length>=this.maxGeneratedFiles||chars>this.maxGeneratedCharacters)throw new RangeError('Combined generated source budget exceeded');files.push(file);}diagnostics.push(...value.diagnostics.map(d=>this.normalize(d,sources)));
    }return {files,diagnostics:diagnostics.slice(0,this.maxDiagnostics),metrics:{...this.metrics}};
  }
  normalize(d,sources){const source=sources.find(s=>s.uri===d.uri)??sources[0]??new SourceText('','extensions://diagnostics');const start=Number.isInteger(d.start)?Math.max(0,Math.min(source.length,d.start)):0,length=Number.isInteger(d.length)?Math.max(0,Math.min(source.length-start,d.length)):0;return diagnostic(source,start,length,String(d.code??'SFEXT001'),String(d.message??'Extension diagnostic'),['error','warning','info','hint'].includes(d.severity)?d.severity:'warning');}
  analyze(compilation,syntax,{signal,options={}}={}){cancelled(signal);const key=JSON.stringify([this.revision,options]);const cached=this.analysisCache.get(compilation);if(cached?.key===key)return cached.diagnostics;const diagnostics=[],sources=syntax.map(s=>s.source);for(const [id,analyzer]of this.analyzers){cancelled(signal);try{this.metrics.analyzerRuns++;synchronous(analyzer.analyze(Object.freeze({compilation,syntax:Object.freeze([...syntax]),options:Object.freeze({...options}),signal,reportDiagnostic:d=>{if(diagnostics.length<this.maxDiagnostics){const severity=options.severities?.[d.code]??d.severity;if(severity!=='none')diagnostics.push(this.normalize({...d,severity},sources));}}})));}catch(error){if(signal?.aborted)throw error;if(diagnostics.length<this.maxDiagnostics)diagnostics.push(this.normalize({code:'SFANA001',message:`Analyzer ${id}: ${error.message}`},sources));}}cancelled(signal);this.analysisCache.set(compilation,{key,diagnostics});return diagnostics;}
}
export const BuildInfoGenerator=Object.freeze({id:'BuildInfo',generate(context){const name=context.options.buildInfoClass??'GeneratedBuildInfo';if(!identifier(name))throw new Error('Invalid build-info class name');context.addSource('BuildInfo.g.cs',`// <auto-generated/>\npublic class ${name} { public static string Version() { return ${JSON.stringify(String(context.options.version??'0.0.0')).replace(/\\u202[89]/g,' ')}; } }\n`);}});
export const JsonSchemaGenerator=Object.freeze({id:'JsonSchema',generate(context){
  for(const file of context.additionalFiles.filter(f=>f.uri.endsWith('.schema.json'))){
    const schema=JSON.parse(file.text);
    if(!identifier(schema.name)||!Array.isArray(schema.fields)||schema.fields.length>128)throw new Error('Schema requires a class name and at most 128 fields');
    const immutable=schema.immutable===true,constructor=schema.constructor===true||immutable,names=new Set();
    const fields=schema.fields.map(f=>{
      if(!identifier(f.name)||f.name===schema.name||names.has(f.name)||!['int','double','bool','string','int[]','double[]','bool[]','string[]'].includes(f.type))throw new Error('Invalid or duplicate schema field');names.add(f.name);
      return `    public ${f.type} ${f.name}${immutable?' { get; }':context.options.schemaProperties?' { get; set; }':';'}`;
    });
    const ctor=constructor?`\n    public ${schema.name}(${schema.fields.map((f,i)=>f.type+' value'+i).join(', ')}) {\n${schema.fields.map((f,i)=>'        this.'+f.name+' = value'+i+';').join('\n')}\n    }\n`:'';
    context.addSource(`${schema.name}.g.cs`,`// <auto-generated/>\npublic class ${schema.name} {\n${fields.join('\n')}\n${ctor}}\n`);
  }
}});
export const UnreferencedLocalAnalyzer=Object.freeze({id:'UnreferencedLocal',analyze({compilation,reportDiagnostic}){const used=new Set(compilation.references.filter(r=>!r.declaration).map(r=>r.symbolId));for(const symbol of compilation.symbols)if(symbol.kind==='local'&&!used.has(symbol.id)&&!symbol.name.startsWith('_'))reportDiagnostic({uri:symbol.uri,start:symbol.start,length:symbol.end-symbol.start,code:'SFAN1001',message:`Local '${symbol.name}' is never referenced.`,severity:'warning'});}});
export const EmptyCatchAnalyzer=Object.freeze({id:'EmptyCatch',analyze({syntax,reportDiagnostic}){for(const file of syntax)for(const node of syntaxNodes(file.root))if(node.kind==='Try')for(const clause of node.catches??[])if(!clause.body.statements.length)reportDiagnostic({uri:file.source.uri,start:clause.body.start,length:clause.body.end-clause.body.start,code:'SFAN1002',message:'Empty catch block suppresses an exception.',severity:'warning'});}});

/** Literal-only diagnostic: no speculative constant folding or side-effect evaluation. */
export const ConstantConditionAnalyzer=Object.freeze({id:'ConstantCondition',analyze({syntax,reportDiagnostic}){
  for(const file of syntax)for(const node of syntaxNodes(file.root))if(['If','While','For'].includes(node.kind)&&node.condition?.kind==='Literal'&&node.condition.type==='bool'){
    // Intentional infinite loops are idiomatic, not warnings.
    if(node.kind!=='If'&&node.condition.value===true)continue;
    reportDiagnostic({uri:file.source.uri,start:node.condition.start,length:node.condition.end-node.condition.start,code:'SFAN1003',message:`Condition is always ${node.condition.value?'true':'false'}.`,severity:'info'});
  }
}});
export const TodoCommentAnalyzer=Object.freeze({id:'TodoComment',analyze({syntax,reportDiagnostic}){
  for(const file of syntax)for(const token of file.tokens){const trivia={text:token.green?.leading??'',start:token.fullStart};
    const pattern=/\b(TODO|FIXME|HACK)\b/g;let match;while((match=pattern.exec(trivia.text)))reportDiagnostic({uri:file.source.uri,start:trivia.start+match.index,length:match[0].length,code:'SFAN1004',message:`${match[0]} comment needs review.`,severity:'hint'});
  }
}});

/** Syntax-local reachability only: no claims about exceptions, dynamic calls, or loop termination. */
export const UnreachableStatementAnalyzer=Object.freeze({id:'UnreachableStatement',analyze({syntax,reportDiagnostic}){
  const terminal=n=>['Return','Throw','Break','Continue'].includes(n?.kind)||n?.kind==='Block'&&terminal(n.statements.at(-1))||n?.kind==='If'&&terminal(n.then)&&terminal(n.otherwise);
  for(const file of syntax)for(const block of syntaxNodes(file.root))if(['Block','CompilationUnit'].includes(block.kind)){
    let stopped=false;for(const statement of block.statements??[]){
      if(stopped&&statement.kind!=='Empty')reportDiagnostic({uri:file.source.uri,start:statement.start,length:statement.end-statement.start,code:'SFAN1005',message:'Statement follows an unconditional control-flow exit in this block.',severity:'warning'});
      stopped ||= terminal(statement);
    }
  }
}});
