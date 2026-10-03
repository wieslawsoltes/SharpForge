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

function sync(files){if(!files)return;const names=new Set(files.map(f=>f.uri));for(const uri of workspace.documents.keys())if(!names.has(uri))workspace.remove(uri);for(const file of files)workspace.update(file.uri,file.text,file.version);}
self.onmessage=event=>{const {id,method,params={}}=event.data;try{sync(params.files);const options=params.compilationOptions??(params.outputKind?{outputKind:params.outputKind}:null);if(options&&JSON.stringify(options)!==JSON.stringify(workspace.compilationOptions)){workspace.compilationOptions=options;workspace.result=null;}if(Object.hasOwn(params,'extensions')&&JSON.stringify(params.extensions??null)!==extensionKey)configureExtensions(params.extensions);let result;
  switch(method){
    case 'analyze':case 'build':{
      const r=workspace.compile();result={...r,image:method==='build'?r.image:undefined,workspaceMetrics:{...workspace.metrics}};
      // Keystroke analysis never emits PE or decodes IL. Only an explicit successful build does.
      if(method==='build'&&r.success){
        const name=params.assemblyName??r.image.name,hit=cachedArtifact?.image===r.image&&cachedArtifact.name===name;
        try{let artifact=hit?cachedArtifact.artifact:emitAssemblyDetailed(r.image,{name});if(!hit){const symbols=emitPortablePdb(artifact.bytes,artifact.symbolData,{embedSources:true});artifact={...artifact,pdb:symbols.bytes,bytes:attachPortablePdb(artifact.bytes,symbols.bytes,{path:name+'.pdb',embedded:true})};}result.pdb=artifact.pdb;cachedArtifact={image:r.image,name,artifact};result.assembly=artifact.bytes;result.format='cil';result.metrics={...r.metrics,...artifact.metrics,emitIlMs:hit?0:artifact.metrics.emitIlMs,assemblyCached:hit};}
        catch(error){if(!(error instanceof CilError))throw error;const source=r.image.sources[0];result={...result,success:false,image:null,assembly:null,diagnostics:[...r.diagnostics,diagnostic(new SourceText(source.text,source.uri),0,1,'SF3001',error.message)],metrics:{...r.metrics,errors:r.metrics.errors+1}};}
      }break;
    }
    case 'inspectAssembly':{
      inspected=new AssemblyInspector(params.assembly);inspectionSession++;const summary=inspected.summary({includeMethods:false});summary.methods=[...inspected.methods.values()].map(m=>{try{return {...m,signature:inspected.signature(m.token)};}catch(error){return {...m,error:error.message};}});result={session:inspectionSession,summary};break;
    }
    case 'methodIL':{const i=inspection(params);result={method:i.getMethod(params.token),source:formatAssembly(i.pe.bytes,{methodToken:params.token})};break;}
    case 'decompileMethod':result=decompileMethod(inspection(params),params.token);break;
    case 'allIL':result=formatAssembly(inspection(params).pe.bytes);break;
    case 'editableIL':result=formatILDocument(inspection(params).pe.bytes);break;
    case 'assembleIL':result=assembleILDocument(params.text);break;
    case 'verifyIL':result=verifyCilAssembly(inspection(params),{methodToken:params.token,arguments:params.arguments??[]});break;
    case 'findInFiles':result=language.findInFiles(params.query,params.options);break;
    case 'replaceAll':result=refactoring.replaceAll(params.query,params.replacement,params.options);break;
    case 'callHierarchy':result=language.callHierarchy(params.uri,params.offset);break;
    case 'incomingCalls':result=language.calls(params.item,'incoming');break;
    case 'outgoingCalls':result=language.calls(params.item,'outgoing');break;
    case 'referenceLenses':result=language.referenceLenses(params.uri);break;
    case 'selectionRanges':result=selectionRanges(workspace,params.uri,params.offsets);break;
    case 'codeActions':result=refactoring.actions(params.uri,params.offset,params.end??params.offset);break;
    case 'format':result={title:'Format document indentation',edits:formatDocument(workspace,params.uri,params.options)};break;
    case 'validateRefactoring':{const candidate=new Workspace({compilationOptions:workspace.compilationOptions,extensions:workspace.extensions,extensionOptions:workspace.extensionOptions,additionalFiles:workspace.additionalFiles});for(const [uri,d]of workspace.documents)candidate.update(uri,d.source.text,d.source.version);result=new RefactoringEngine(candidate,new LanguageService(candidate)).apply(params.action);break;}
    case 'validateDesigner':{
      const candidate=new Workspace({compilationOptions:workspace.compilationOptions,extensions:workspace.extensions,extensionOptions:workspace.extensionOptions,additionalFiles:workspace.additionalFiles});for(const [uri,d]of workspace.documents)candidate.update(uri,d.source.text,d.source.version);
      new RefactoringEngine(candidate,new LanguageService(candidate)).apply(params.action,{validate:false});const compiled=candidate.compile();if(!compiled.success)throw new Error('Designer changes do not compile: '+compiled.diagnostics.filter(d=>d.severity==='error').slice(0,10).map(d=>d.message).join('; '));result={success:true};break;
    }
    case 'configureExtensions':result=configureExtensions(params.extensions??params);break;
    case 'importAssembly':{
      const image=loadAssembly(params.assembly);result={success:true,image,assembly:params.assembly,format:'cil',diagnostics:[],symbols:[],references:[],metrics:{compileMs:0,files:image.sources.length,methods:image.methods.length,instructions:image.methods.reduce((n,m)=>n+m.code.length/3,0),errors:0,assemblyBytes:params.assembly.length,loadMs:image.il.loadMs}};break;
    }
    case 'completion':result=language.completions(params.uri,params.offset);break;
    case 'hover':result=language.hover(params.uri,params.offset);break;
    case 'definition':result=language.definition(params.uri,params.offset);break;
    case 'references':result=language.references(params.uri,params.offset);break;
    case 'rename':result=refactoring.rename(params.uri,params.offset,params.newName).edits;break;
    case 'symbols':result=language.documentSymbols(params.uri);break;
    default:throw new Error(`Unknown compiler request '${method}'`);
  }
  self.postMessage({id,result,revision:params.revision});
}catch(error){self.postMessage({id,error:{message:error.message,name:error.name}});}};
