import {registerEditorLanguageHandlers} from './workers/editor-language.js';
import {createWorkerProtocol,readWorkerRequest} from './workers/protocol.js';
import {createCompilationHandler} from './workers/compilation-handler.js';
import {registerTypeRenameHandlers} from './workers/type-rename.js';
import {registerDocumentLifecycleHandlers,syncWorkerDocuments} from './workers/document-lifecycle.js';
import { ExtensionDriver, BuildInfoGenerator, JsonSchemaGenerator, EmptyCatchAnalyzer, UnreferencedLocalAnalyzer, ConstantConditionAnalyzer, TodoCommentAnalyzer, UnreachableStatementAnalyzer } from '@sharpforge/extensions';
import { RefactoringEngine } from '@sharpforge/refactoring';
import { Workspace } from '@sharpforge/workspace';
import { LanguageService } from '@sharpforge/language';
import { loadAssembly, AssemblyInspector, decompileMethod, formatAssembly, formatILDocument, assembleILDocument, verifyCilAssembly } from '@sharpforge/cil';
const workspace=new Workspace(),language=new LanguageService(workspace),refactoring=new RefactoringEngine(workspace,language);
let inspected=null,inspectionSession=0;
function inspection(params){if(!inspected||params.session!==inspectionSession)throw new Error('Assembly inspection session is stale; reopen the assembly');return inspected;}
let extensionKey='null';
function configureExtensions(params){const driver=new ExtensionDriver();if(params?.buildInfo)driver.registerGenerator(BuildInfoGenerator);if(params?.schema)driver.registerGenerator(JsonSchemaGenerator);if(params?.analyzers)driver.registerAnalyzer(EmptyCatchAnalyzer).registerAnalyzer(UnreferencedLocalAnalyzer).registerAnalyzer(ConstantConditionAnalyzer).registerAnalyzer(TodoCommentAnalyzer).registerAnalyzer(UnreachableStatementAnalyzer);workspace.extensions=driver;workspace.extensionOptions={version:params?.version??'0.14.0',schemaProperties:!!params?.schemaProperties,severities:params?.severities??{}};workspace.additionalFiles=params?.additionalFiles??[];workspace.result=null;extensionKey=JSON.stringify(params??null);return {generators:[...driver.generators.keys()],analyzers:[...driver.analyzers.keys()]};}

const handlers=createWorkerProtocol('compiler');
registerDocumentLifecycleHandlers(handlers,{workspace});
registerEditorLanguageHandlers(handlers,{workspace,language,refactoring});
const compileRequest=createCompilationHandler(workspace);
for(const method of ['analyze','build'])handlers.registerHandler(method,compileRequest);
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
for(const method of ["validateRefactoring"])handlers.registerHandler(method,(params,method)=>{let result;{const candidate=new Workspace({compilationOptions:workspace.compilationOptions,extensions:workspace.extensions,extensionOptions:workspace.extensionOptions,additionalFiles:workspace.additionalFiles});for(const [uri,d]of workspace.documents)candidate.update(uri,d.source.text,d.source.version);result=new RefactoringEngine(candidate,new LanguageService(candidate)).apply(params.action);return result;}});
for(const method of ["validateDesigner"])handlers.registerHandler(method,(params,method)=>{let result;{
      const candidate=new Workspace({compilationOptions:workspace.compilationOptions,extensions:workspace.extensions,extensionOptions:workspace.extensionOptions,additionalFiles:workspace.additionalFiles});for(const [uri,d]of workspace.documents)candidate.update(uri,d.source.text,d.source.version);
      new RefactoringEngine(candidate,new LanguageService(candidate)).apply(params.action,{validate:false});const compiled=candidate.compile();if(!compiled.success)throw new Error('Designer changes do not compile: '+compiled.diagnostics.filter(d=>d.severity==='error').slice(0,10).map(d=>d.message).join('; '));result={success:true};return result;
    }});
for(const method of ["configureExtensions"])handlers.registerHandler(method,(params,method)=>{let result;result=configureExtensions(params.extensions??params);return result;});
for(const method of ["importAssembly"])handlers.registerHandler(method,(params,method)=>{let result;{
      const image=loadAssembly(params.assembly);result={success:true,image,assembly:params.assembly,format:'cil',diagnostics:[],symbols:[],references:[],metrics:{compileMs:0,files:image.sources.length,methods:image.methods.length,instructions:image.methods.reduce((n,m)=>n+m.code.length/3,0),errors:0,assemblyBytes:params.assembly.length,loadMs:image.il.loadMs}};return result;
    }});
registerTypeRenameHandlers(handlers,{language,refactoring,registerRename:false});
self.onmessage=event=>{const id=event.data?.id;try{const {method,params}=readWorkerRequest(event.data);handlers.assertMethod(method);syncWorkerDocuments(workspace,params.files);const options=params.compilationOptions??(params.outputKind?{outputKind:params.outputKind}:null);if(options&&JSON.stringify(options)!==JSON.stringify(workspace.compilationOptions)){workspace.compilationOptions=options;workspace.result=null;}if(Object.hasOwn(params,'extensions')&&JSON.stringify(params.extensions??null)!==extensionKey)configureExtensions(params.extensions);let result;
  result=handlers.dispatch(method,params);
  self.postMessage({id,result,revision:params.revision});
}catch(error){self.postMessage({id,error:{message:error.message,name:error.name,code:error.code}});}};
