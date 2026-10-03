import { registerDesignerWorker } from './designer-worker.js';
import {createWorkerProtocol} from './workers/protocol.js';
import {createCompilerWorkerDispatcher} from './designer-worker-dispatcher.js';
import {emitPortablePdb,attachPortablePdb} from '../../packages/symbols/src/index.js';
import { ExtensionDriver, BuildInfoGenerator, JsonSchemaGenerator, EmptyCatchAnalyzer, UnreferencedLocalAnalyzer, ConstantConditionAnalyzer, TodoCommentAnalyzer, UnreachableStatementAnalyzer } from '../../packages/extensions/src/index.js';
import { RefactoringEngine, formatDocument, selectionRanges } from '../../packages/refactoring/src/index.js';
import { Workspace } from '../../packages/workspace/src/index.js';
import { LanguageService } from '../../packages/language/src/index.js';
import { emitAssemblyDetailed, loadAssembly, CilError, AssemblyInspector, decompileMethod, formatAssembly, formatILDocument, assembleILDocument, verifyCilAssembly } from '../../packages/cil/src/index.js';
import { SourceText, diagnostic } from '../../packages/text/src/index.js';
const workspace=new Workspace(),language=new LanguageService(workspace),refactoring=new RefactoringEngine(workspace,language);
let inspected=null,inspectionSession=0;
function inspection(params){if(!inspected||params.session!==inspectionSession)throw new Error('Assembly inspection session is stale; reopen the assembly');return inspected;}
let cachedArtifact=null;
let extensionKey='null';
function configureExtensions(params){const driver=new ExtensionDriver();if(params?.buildInfo)driver.registerGenerator(BuildInfoGenerator);if(params?.schema)driver.registerGenerator(JsonSchemaGenerator);if(params?.analyzers)driver.registerAnalyzer(EmptyCatchAnalyzer).registerAnalyzer(UnreferencedLocalAnalyzer).registerAnalyzer(ConstantConditionAnalyzer).registerAnalyzer(TodoCommentAnalyzer).registerAnalyzer(UnreachableStatementAnalyzer);workspace.extensions=driver;workspace.extensionOptions={version:params?.version??'0.14.0',schemaProperties:!!params?.schemaProperties,severities:params?.severities??{}};workspace.additionalFiles=params?.additionalFiles??[];workspace.result=null;extensionKey=JSON.stringify(params??null);return {generators:[...driver.generators.keys()],analyzers:[...driver.analyzers.keys()]};}

const handlers=createWorkerProtocol('compiler');
registerDesignerWorker(handlers, { workspace });
for(const method of ["analyze","build"])handlers.registerHandler(method,(params,method)=>{let result;{
      const r=workspace.compile();result={...r,image:method==='build'?r.image:undefined,workspaceMetrics:{...workspace.metrics}};
      // Keystroke analysis never emits PE or decodes IL. Only an explicit successful build does.
      if(method==='build'&&r.success){
        const name=params.assemblyName??r.image.name,hit=cachedArtifact?.image===r.image&&cachedArtifact.name===name;
        try{let artifact=hit?cachedArtifact.artifact:emitAssemblyDetailed(r.image,{name});if(!hit){const symbols=emitPortablePdb(artifact.bytes,artifact.symbolData,{embedSources:true});artifact={...artifact,pdb:symbols.bytes,bytes:attachPortablePdb(artifact.bytes,symbols.bytes,{path:name+'.pdb',embedded:true})};}result.pdb=artifact.pdb;cachedArtifact={image:r.image,name,artifact};result.assembly=artifact.bytes;result.format='cil';result.metrics={...r.metrics,...artifact.metrics,emitIlMs:hit?0:artifact.metrics.emitIlMs,assemblyCached:hit};}
        catch(error){if(!(error instanceof CilError))throw error;const source=r.image.sources[0];result={...result,success:false,image:null,assembly:null,diagnostics:[...r.diagnostics,diagnostic(new SourceText(source.text,source.uri),0,1,'SF3001',error.message)],metrics:{...r.metrics,errors:r.metrics.errors+1}};}
      }return result;
    }});
for(const method of ["inspectAssembly"])handlers.registerHandler(method,(params,method)=>{let result;{
      inspected=new AssemblyInspector(params.assembly);inspectionSession++;const summary=inspected.summary({includeMethods:false});summary.methods=[...inspected.methods.values()].map(m=>{try{return {...m,signature:inspected.signature(m.token)};}catch(error){return {...m,error:error.message};}});result={session:inspectionSession,summary};return result;
    }});
for(const method of ["methodIL"])handlers.registerHandler(method,(params,method)=>{let result;{const i=inspection(params);result={method:i.getMethod(params.token),source:formatAssembly(i.pe.bytes,{methodToken:params.token})};return result;}});
for(const method of ["decompileMethod"])handlers.registerHandler(method,(params,method)=>{let result;result=decompileMethod(inspection(params),params.token);return result;});
for(const method of ["allIL"])handlers.registerHandler(method,(params,method)=>{let result;result=formatAssembly(inspection(params).pe.bytes);return result;});
for(const method of ["editableIL"])handlers.registerHandler(method,(params,method)=>{let result;result=formatILDocument(inspection(params).pe.bytes);return result;});
for(const method of ["assembleIL"])handlers.registerHandler(method,(params,method)=>{let result;result=assembleILDocument(params.text);return result;});
for(const method of ["verifyIL"])handlers.registerHandler(method,(params,method)=>{let result;result=verifyCilAssembly(inspection(params),{methodToken:params.token,arguments:params.arguments??[]});return result;});
for(const method of ["findInFiles"])handlers.registerHandler(method,(params,method)=>{let result;result=language.findInFiles(params.query,params.options);return result;});
for(const method of ["replaceAll"])handlers.registerHandler(method,(params,method)=>{let result;result=refactoring.replaceAll(params.query,params.replacement,params.options);return result;});
for(const method of ["callHierarchy"])handlers.registerHandler(method,(params,method)=>{let result;result=language.callHierarchy(params.uri,params.offset);return result;});
for(const method of ["incomingCalls"])handlers.registerHandler(method,(params,method)=>{let result;result=language.calls(params.item,'incoming');return result;});
for(const method of ["outgoingCalls"])handlers.registerHandler(method,(params,method)=>{let result;result=language.calls(params.item,'outgoing');return result;});
for(const method of ["referenceLenses"])handlers.registerHandler(method,(params,method)=>{let result;result=language.referenceLenses(params.uri);return result;});
for(const method of ["selectionRanges"])handlers.registerHandler(method,(params,method)=>{let result;result=selectionRanges(workspace,params.uri,params.offsets);return result;});
for(const method of ["codeActions"])handlers.registerHandler(method,(params,method)=>{let result;result=refactoring.actions(params.uri,params.offset,params.end??params.offset);return result;});
for(const method of ["format"])handlers.registerHandler(method,(params,method)=>{let result;result={title:'Format document indentation',edits:formatDocument(workspace,params.uri,params.options)};return result;});
for(const method of ["configureExtensions"])handlers.registerHandler(method,(params,method)=>{let result;result=configureExtensions(params.extensions??params);return result;});
for(const method of ["importAssembly"])handlers.registerHandler(method,(params,method)=>{let result;{
      const image=loadAssembly(params.assembly);result={success:true,image,assembly:params.assembly,format:'cil',diagnostics:[],symbols:[],references:[],metrics:{compileMs:0,files:image.sources.length,methods:image.methods.length,instructions:image.methods.reduce((n,m)=>n+m.code.length/3,0),errors:0,assemblyBytes:params.assembly.length,loadMs:image.il.loadMs}};return result;
    }});
for(const method of ["completion"])handlers.registerHandler(method,(params,method)=>{let result;result=language.completions(params.uri,params.offset);return result;});
for(const method of ["hover"])handlers.registerHandler(method,(params,method)=>{let result;result=language.hover(params.uri,params.offset);return result;});
for(const method of ["definition"])handlers.registerHandler(method,(params,method)=>{let result;result=language.definition(params.uri,params.offset);return result;});
for(const method of ["references"])handlers.registerHandler(method,(params,method)=>{let result;result=language.references(params.uri,params.offset);return result;});
for(const method of ["rename"])handlers.registerHandler(method,(params,method)=>{let result;result=refactoring.rename(params.uri,params.offset,params.newName).edits;return result;});
for(const method of ["symbols"])handlers.registerHandler(method,(params,method)=>{let result;result=language.documentSymbols(params.uri);return result;});
const dispatcher = createCompilerWorkerDispatcher(handlers, {
  workspace, configureExtensions, extensionKey: () => extensionKey, postMessage: message => self.postMessage(message)
});
self.onmessage = event => dispatcher.receive(event.data);
