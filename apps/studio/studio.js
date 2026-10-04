import {mountStudioComposition,studioEditorOptions,studioWorkspaceMetadata} from './workbench/studio-composition.js';
import {installWatchWindows} from './workbench/watch-windows/index.js';
import {createStudioLanguageProviders} from './workbench/studio-language-providers.js';
import {applyExplorerResourceTransaction} from './explorer-resource-transaction.js';
import {saveStudioSourceAs} from './workbench/source-save-as.js';
import {canRecoverStudioWorkspace,storeStudioRecovery} from './workbench/studio-recovery-store.js';
import {createStudioLocationOpener} from './workbench/studio-open-location.js';
import {StudioNavigation} from './workbench/studio-navigation.js';
import {SessionRecovery} from './workbench/session-recovery.js';
import {createRuntimeToolsBridge} from './workbench/session-runtime-bridge.js';
import {readStudioFiles,readStudioDirectory} from './workbench/source-imports.js';
import {importStudioFiles,openStudioWorkspaceZip} from './workbench/studio-file-import.js';
import {loadStudioSample,importStudioAssembly} from './workbench/studio-built-in-workspace.js';
import {readStudioSource} from './workbench/studio-source-reader.js';
import {loadStudioWorkspace} from './workbench/studio-workspace-loader.js';
import {WorkspaceLoads} from './workbench/workspace-loads.js';
import {StudioWorkspaceInputs} from './workbench/studio-workspace-inputs.js';
import {createStudioDiskObserver} from './workbench/studio-disk-observer.js';
import {commitStudioExplorerWorkspace} from './workbench/studio-explorer-workspace.js';
import {importStudioExistingProject} from './workbench/studio-existing-project.js';
import {studioSourceRecord} from './workbench/studio-source-records.js';
import {createStudioRecords} from './workbench/workspace-records.js';
import {studioDiskLimits,validateStudioSources} from './workbench/workspace-limits.js';
import {createStudioLazyFeatures} from './workbench/lazy-features/index.js';
import {createWorkbenchServices,legacyRuntimeEvent} from './workbench/sessions.js';
import {StudioProjects} from './workbench/studio-projects.js';
import {createStudioEditorFactory,remapBreakpointChanges} from './workbench/studio-editor.js';
import {EditorModel,rebaseEditorSource} from '@sharpforge/editor';
import {StudioExecution} from './workbench/studio-execution.js';
import {createStudioRuntimeReveals} from './workbench/studio-runtime-reveals.js';
import {selectStudioStartupProject} from './workbench/studio-startup-project.js';
import {StudioSave} from './workbench/studio-save.js';
import {storage,storageKeys} from './settings/storage.js';
import {contributeRuntimeAutomation} from './tools/runtime-automation.js';
import {contributeWorkspaceAutomation} from './tools/workspace-automation.js';
import {contributeDesignerAutomation} from './tools/designer-automation.js';
import {contributeDebuggerAutomation} from './tools/debugger-automation.js';
import {contributeMsbuildAutomation} from './tools/msbuild-automation.js';
import {contributeDockingAutomation} from './tools/docking-automation.js';
import {createServiceRegistry} from './services/registry.js';
import {createCommandRegistry} from './commands/registry.js';
import {registerStudioCommands} from './commands/core.js';
import {createMenuRegistry} from './menus/registry.js';
import {registerStudioMenus} from './menus/core.js';
import {createContextMenus} from './menus/context.js';
import {createToolRegistry} from './tools/registry.js';
import {createStudioRenderers} from './tools/core.js';
import {createAutomationApi} from './automation-api.js';
import {icon} from './icons.js';
import {createAboutDialogs} from './dialogs/about.js';
import {RuntimeTools} from './runtime-tools.js';
import {importWorkspaceRecords,workspaceManifestRecord,importWorkspaceZip,exportWorkspaceZip,validateWorkspaceSettings,workspaceCandidates,writeNewDirectory,decodeWorkspaceFile,encodeWorkspaceFile,prefixWorkspace,convertLegacySolution} from '../../packages/project-system/src/index.js';
import {validateFilePlan,createProjectPlan,createItemPlan,projectTemplates,itemTemplates} from '../../packages/templates/src/index.js';
import {DebuggerExtensions} from './debugger-extensions.js';
import {DebuggerTools,debuggerDefaults} from './debugger-tools.js';
import {SolutionExplorer} from './solution-explorer.js';
import {ExplorerCommands} from './explorer-commands.js';
import {ContextMenu} from '../../packages/controls/src/index.js';
import {EDITOR_KEYMAPS} from '../../packages/editor/src/index.js';
import {remapSourceBreakpoints,sourceBreakpointAt} from '../../packages/debugger/src/breakpoints.js';
import { StudioDocking, toolDefinitions } from './docking-workspace.js';
import { ProjectSystem, DiskWorkspace, addSolutionProject, addSolutionItem, createCsproj, createSlnx, normalizePath, validateItemPath, parseXml } from '../../packages/project-system/src/index.js';
import { CodeEditor, escapeHtml as E } from '../../packages/editor/src/index.js';
import { SourceText } from '../../packages/text/src/index.js';
import { disassemble, serializeImage } from '../../packages/bytecode/src/index.js';
import { disassembleAssembly, formatAssembly, createRuntimeConfig } from '../../packages/cil/src/index.js';
import { samples } from './samples.js';
const studioServices=createServiceRegistry();
studioServices.registerAll([{name:'commands',factory:()=>createCommandRegistry({onExecute:id=>execution.reveals.command(id)}),dispose:r=>r.dispose()},{name:'menus',factory:createMenuRegistry,dispose:r=>r.dispose()},{name:'tools',factory:createToolRegistry,dispose:r=>r.dispose()},{name:'automation',factory:createAutomationApi,dispose:r=>r.dispose()}]);
const commandRegistry=studioServices.get('commands'),menuRegistry=studioServices.get('menus'),toolRegistry=studioServices.get('tools'),automation=studioServices.get('automation');
const toolMounts=new Map();
const studioRenderers=createStudioRenderers({get $(){return $;},get $$(){return $$;},get E(){return E;},get advancedTools(){return advancedTools;},get breakOnWrite(){return breakOnWrite;},get debugTools(){return debugTools;},get designerTools(){return designerTools;},get disassemble(){return disassemble;},get disassembleAssembly(){return disassembleAssembly;},get docking(){return docking;},get editLocal(){return editLocal;},get empty(){return empty;},get formatBytes(){return formatBytes;},get hydrate(){return hydrate;},get ilDebugger(){return ilDebugger;},get inspectObject(){return inspectObject;},get nativeBuild(){return nativeBuild;},get openFile(){return openFile;},get openMenuAt(){return openMenuAt;},get refreshWatches(){return refreshWatches;},get runtimeTools(){return runtimeTools;},get saveLocal(){return saveLocal;},get selectDebugFrame(){return selectDebugFrame;},get setPanel(){return setPanel;},get state(){return state;},get toast(){return toast;},get workbench(){return workbench;},get applyRefactoring(){return applyRefactoring;},get build(){return build;},get closeModal(){return closeModal;},get download(){return download;},get loadSample(){return loadSample;},get reloadDiskProject(){return reloadDiskProject;},get requestCompiler(){return requestCompiler;},get samples(){return samples;},get setStartupProject(){return setStartupProject;},get showModal(){return showModal;},get toolDefinitions(){return toolDefinitions;},get EDITOR_KEYMAPS(){return EDITOR_KEYMAPS;},get setEditorKeymap(){return setEditorKeymap;}});
for(const {id,title}of toolDefinitions)toolRegistry.registerTool(id,title,element=>studioRenderers.renderPanel(id,element));
const contextMenus=createContextMenus({get EDITOR_KEYMAPS(){return EDITOR_KEYMAPS;},get advancedTools(){return advancedTools;},get breakpointItems(){return breakpointItems;},get copyText(){return copyText;},get languageRequest(){return languageRequest;},get pasteEditor(){return pasteEditor;},get refreshWatches(){return refreshWatches;},get setEditorKeymap(){return setEditorKeymap;},get setPanel(){return setPanel;},get state(){return state;},get $(){return $;},get E(){return E;},get ask(){return ask;},get breakOnWrite(){return breakOnWrite;},get build(){return build;},get debugTools(){return debugTools;},get dockMenuItems(){return dockMenuItems;},get docking(){return docking;},get download(){return download;},get editLocal(){return editLocal;},get execute(){return execute;},get explorerActions(){return explorerActions;},get inspectObject(){return inspectObject;},get renderPanel(){return renderPanel;},get saveLocal(){return saveLocal;},get solutionExplorer(){return solutionExplorer;},get sourceBreakpointAt(){return sourceBreakpointAt;},get toggleBreakpoint(){return toggleBreakpoint;},get syncBreakpoints(){return syncBreakpoints;},get setEditorDecorations(){return setEditorDecorations;},get editBreakpoint(){return editBreakpoint;},get runtime(){return runtime;},get launch(){return launch;},get editorHostCommand(){return editorHostCommand;},get openFile(){return openFile;}});
for(const [id,builder]of Object.entries(contextMenus))menuRegistry.registerMenu(id,builder);
registerStudioMenus(menuRegistry,{toolDefinitions});
registerStudioCommands(commandRegistry,{get designerTools(){return designerTools;},get docking(){return docking;},get renderPanel(){return renderPanel;},get state(){return state;},get advancedTools(){return advancedTools;},get setPanel(){return setPanel;},get showNextStatement(){return showNextStatement;},get debugTools(){return debugTools;},get nativeBuild(){return nativeBuild;},get navigate(){return navigate;},get openFolder(){return openFolder;},get $(){return $;},get saveToDisk(){return saveToDisk;},get createCsproj(){return createCsproj;},get download(){return download;},get createSlnx(){return createSlnx;},get openAssemblyExplorer(){return openAssemblyExplorer;},get codeActions(){return codeActions;},get languageRequest(){return languageRequest;},get launch(){return launch;},get build(){return build;},get runtime(){return runtime;},get ilDebugger(){return ilDebugger;},get stopQuietly(){return stopActiveSession;},get runToCursor(){return runToCursor;},get step(){return step;},get editor(){return editor;},get editorHostCommand(){return editorHostCommand;},get exportProject(){return exportProject;},get exportLegacyProject(){return exportLegacyProject;},get openProjectWizard(){return openProjectWizard;},get saveWorkspaceFolder(){return saveWorkspaceFolder;},get newFile(){return newFile;},get toast(){return toast;},get createRuntimeConfig(){return createRuntimeConfig;},get formatAssembly(){return formatAssembly;},get serializeImage(){return serializeImage;},get aboutDialog(){return aboutDialog;},get shortcutsDialog(){return shortcutsDialog;},get profileDialog(){return profileDialog;},get architectureDialog(){return architectureDialog;},get commandsDialog(){return commandsDialog;},get saveLocal(){return saveLocal;},get showCallHierarchy(){return showCallHierarchy;},get inspectHeap(){return inspectHeap;},get formatBytes(){return formatBytes;},get toggleTool(){return toggleTool;},get importFiles(){return importFiles;},get EDITOR_KEYMAPS(){return EDITOR_KEYMAPS;},get setEditorKeymap(){return setEditorKeymap;},get toggleBreakpoint(){return toggleBreakpoint;},get toolDefinitions(){return toolDefinitions;}});
const aboutDialogs=createAboutDialogs({get showModal(){return showModal;},get $(){return $;},get shortcutsDialog(){return shortcutsDialog;}});
let panelLookup=null;
const $=(selector,root=document)=>root.querySelector(selector)??(root===document&&panelLookup?[...panelLookup.values()].map(panel=>panel.querySelector(selector)).find(Boolean):null),$$=(selector,root=document)=>[...root.querySelectorAll(selector),...(root===document&&panelLookup?[...panelLookup.values()].filter(panel=>panel.ownerDocument!==document).flatMap(panel=>[...panel.querySelectorAll(selector)]):[])];

function hydrate(root=document){$$('[data-icon]',root).forEach(el=>el.innerHTML=icon(el.dataset.icon));}
let workbenchShell=null,sessionUI=null,editorIntegration=null,studioKeyboard=null,editorHost=null,backgroundTasks=null;
const workbenchServices=createWorkbenchServices({
 compilerUrl:new URL('./compiler.worker.js',import.meta.url),runtimeUrl:new URL('./runtime.worker.js',import.meta.url),
 createModel:record=>new EditorModel(record.text,{uri:record.uri,version:record.version}),
 createEditor:(record,options)=>editorIntegration.create(record,options),saveDocument:record=>saveSourceRecord(record),
 coordinateDocumentSave:transaction=>studioSave.coordinate(transaction),
 getProjectSnapshot:id=>projectServices.snapshot(id),onError:error=>toast(error.message,'error'),
 onActiveState:(debug,session,event)=>activeSessionChanged(debug,session,event),onActiveOutput:()=>renderPanelSoon(),
 onSessionEvent:event=>{if(event.type==='loaded'&&event.active)runtimeEvent(legacyRuntimeEvent(event.session,event.event));
  if(event.type==='control'||event.type==='selected')updateDebugButtons();},
 launchOptions:()=>({...state.debugSettings,functionBreakpoints:state.functionBreakpoints}),
 onReveal:id=>setPanel(id),
 onApplication:session=>{execution.followLaunch(session);session.watches=[...(workbenchServices.stateSlices?.sessions.watches??[])];},
 launchCapabilities:()=>({arguments:true,environment:true})
});
const state=workbenchServices.createStateFacade({langVersion:'14',debugSettings:{...debuggerDefaults},functionBreakpoints:[],debugSources:new Map(),immediateHistory:[],launchEpoch:0,launchBusy:false,extraFiles:[],folders:[],membershipDirty:false,keymap:'visual-studio',itemSelection:[],nativeMode:false,nativeWorkspace:null,nativeJob:null,projectSystem:null,projectSnapshot:null,startupProject:null,disk:null,diskRevision:0,configuration:'Debug',projectDiagnostics:[],toolReferences:[],extensionConfig:null,files:[],name:'ParticleLab',active:'Program.cs',tabs:[],revision:1,result:null,image:null,assembly:null,ilDump:null,disassemblyFormat:'cil',importedAssembly:false,buildDirty:false,dirtyFiles:new Set(),logs:[],programOutput:'',panel:'output',debug:null,breakpoints:{},watches:['total','tick','particles.Length'],watchResults:new Map(),frameId:null,readOnly:false,analyzeTimer:null,saveTimer:null,compileBusy:false,selectedMethod:null,outputKind:'all',modalClose:null});
const projectServices=new StudioProjects(workbenchServices,{state:()=>state,onError:error=>toast(error.message,'error')});
const workspaceLoads=new WorkspaceLoads();
const workspaceInputs=new StudioWorkspaceInputs({begin:()=>beginWorkspaceLoad(),onError:error=>toast(error.message,'error')});
function beginWorkspaceLoad(signal){return workspaceLoads.begin({state,documents:workbenchServices.documents,signal});}
async function withWorkspaceLoad(action,options={}){
 const load=options.load??beginWorkspaceLoad(options.signal);
 try{load.check();return await action(load);}finally{if(!options.load)load.finish();}
}
projectServices.sync();
const sessionRecovery=new SessionRecovery(workbenchServices);
const runtimeBridge=createRuntimeToolsBridge({services:workbenchServices,state:()=>state,
 getProjectId:()=>projectServices.currentProjectId,save:saveLocal,onChanged:()=>runtimeTools?.update()});
const execution=new StudioExecution({services:workbenchServices,projects:projectServices,state:()=>state,ui:{
 applyAnalysis,setPanel,status,refresh:()=>{renderTree();renderTabs();renderPanel();},
 nativeBuild:()=>nativeBuild,openAssembly:openAssemblyExplorer,error:error=>toast(error.message,'error'),
 setBusy:value=>{state.launchBusy=value;updateDebugButtons();},
 stopped:()=>{objectRequest++;workbenchServices.locks.refresh();updateDebugButtons();setEditorDecorations();}
}});
const studioSave=new StudioSave({documents:workbenchServices.documents,state:()=>state,nativeBuild:()=>nativeBuild,
 saveRecovery:saveLocal,canRecover:()=>canRecoverStudioWorkspace(workbenchServices.documents,state.extraFiles),
 saveAs:(snapshot,options)=>saveStudioSourceAs(snapshot,{...options,download}),notify:toast,refresh:()=>{renderTabs();renderTree();}});
const diskObserver=createStudioDiskObserver({documents:workbenchServices.documents,state:()=>state,nativeBuild:()=>nativeBuild,
 target:uri=>studioSave.target(uri),confirm:message=>globalThis.confirm(message)});
function saveSourceRecord(record){return studioSave.source(record);}

try{const preferences=JSON.parse(storage.getItem(storageKeys.editor)??'{}');if(EDITOR_KEYMAPS.some(k=>k.id===preferences.keymap))state.keymap=preferences.keymap;}catch{}
try{const p=JSON.parse(storage.getItem(storageKeys.debugger)??'{}');for(const key of Object.keys(debuggerDefaults))if(typeof p[key]===typeof debuggerDefaults[key])state.debugSettings[key]=p[key];}catch{}
const sharedMenu=new ContextMenu({root:$('#menu-popup'),onError:error=>toast(error.message,'error')});
const compiler=workbenchServices.compiler;
const runtime=workbenchServices.runtime;
hydrate();
let editor=null,advancedTools=null,designerTools=null,runtimeTools=null;
const editors=workbenchServices.documents.editors;
let navigation=null,recentWorkspaces=null,openLocation=null;
let testCodeLens=null;
function navigationButtons(){for(const [id,enabled]of [['navigate-back',navigation?.canBack],['navigate-forward',navigation?.canForward]]){const button=document.getElementById(id);if(button)button.disabled=!enabled;}}
function navigate(direction){const target=navigation[direction]();navigationButtons();return target;}

editorIntegration=createStudioEditorFactory({services:workbenchServices,state:()=>state,
 providers:createStudioLanguageProviders({projects:projectServices,documents:workbenchServices.documents,state:()=>state,
  getTestCodeLens:()=>testCodeLens,requestHost:editorHostCommand}),
 applyResourceTransaction:plan=>applyExplorerResourceTransaction(plan,{documents:workbenchServices.documents,explorer:explorerActions}),
 supportsResourceRename:()=>!state.nativeMode,
 getConfigurationRecords:()=>explorerContext().records,getLanguageOptions:()=>studioEditorOptions(workbenchShell?.settings.snapshot()),
 requestCompiler:(method,params,options)=>projectServices.request(method,params,options),requestHost:editorHostCommand,
 onKeymapState:(uri,value)=>{if(!state.active||state.active===uri)updateKeymapStatus(value);},
 onCursor:(uri,position)=>{if(state.active===uri)$('#status-cursor').textContent=`Ln ${position.line+1}, Col ${position.character+1}`;workbenchShell?.update({type:'cursor'});},
 onFocus:(uri,instance)=>{editor=instance;editors.set(uri,instance);state.active=uri;renderBreadcrumb();workbenchShell?.update({type:'selection'});},
 onBreakpoint:toggleBreakpoint,onBreakpointEdit:(uri,line,event)=>event?showBreakpointMenu(uri,line,event):editBreakpoint(uri,line),
 openDocument:location=>openLocation(location),onError:error=>toast(error.message,'error')
});
function createSourceDocument(uri,options){return workbenchServices.documents.createDocument(uri,options);}
function resetEditors(){navigation?.clear();navigationButtons();for(const id of [...docking.host.popouts.keys()])
 if(docking.tabs?.metadata(id))docking.host.returnPopout(id);workbenchServices.documents.resetEditors();editor=null;
 for(const id of [...docking.content.keys()])if(docking.tabs?.metadata(id)){docking.host.contents.delete(id);docking.content.delete(id);}}
const docking=new StudioDocking({createDocument:createSourceDocument,
 onActivate:id=>{workbenchServices.reveal.userIntent();const view=docking.tabs?.metadata(id);if(view)openFile(view.uri,null,null,view);else {state.panel=id;renderPanel(id);}},
 onError:error=>toast(error.message,'error'),onWindowKeyDown:event=>globalKeyDown(event),
 onPopoutDocument:child=>{installContextDocument(child);execution.reveals.install(child);studioKeyboard?.install(child);},
 onClose:id=>{if(docking.tabs?.metadata(id)||id.startsWith('source:')){const uri=docking.tabs?.metadata(id)?.uri??id.slice(7);
  if(state.active===uri&&state.tabs.length)openFile(state.tabs.at(-1));}saveLocal();}});
docking.attachDocuments(workbenchServices.documents,{copyPath:uri=>copyText(uri),revealFile:uri=>openFile(uri)});
const watchWindows=installWatchWindows({docking,sessions:workbenchServices.sessions,commands:commandRegistry,
 storage,onError:error=>toast(error.message,'error')});
menuRegistry.registerMenu('window',watchWindows.descriptors.map(command=>[command.title,command.id,'']));
navigation=new StudioNavigation({docking,getEditor:()=>editor,onChanged:navigationButtons});
openLocation=createStudioLocationOpener({docking,navigation,openFile});
workbenchServices.documents.subscribe(event=>{
 if(event.type==='changed')sourceDocumentChanged(event);
 if(event.type==='dirty'){renderTabs();renderTree();}
 if(event.type==='view')studioKeyboard?.attach(event.editor);
});
panelLookup=docking.content;
runtimeTools=new RuntimeTools({state:runtimeBridge.state,settings:runtimeBridge,
 request:(...args)=>runtimeBridge.request(...args),build:()=>runtimeBridge.build(),save:saveLocal,toast});
const debugTools=new DebuggerTools({state,docking,request:(...a)=>runtime.request(...a),ask,toast,save:saveLocal,openFile,render:renderPanel,decorate:setEditorDecorations,syncSource:syncBreakpoints,editSource:editBreakpoint,toggleSource:toggleBreakpoint,showNext:()=>showNextStatement(),onSettings:()=>{
$('#exception-mode').value=state.debugSettings.exceptionBreak;}});
advancedTools=new DebuggerExtensions({state,docking,sessions:workbenchServices.sessions,
 getApplicationWindows:()=>sessionUI?.applications,request:(...args)=>runtime.request(...args),compile:()=>requestCompiler('build'),
 setReadOnly:value=>{if(workbenchServices.sessions.active)workbenchServices.sessions.active.hotEdit=!value;workbenchServices.locks.refresh();updateDebugButtons();setEditorDecorations();},
 restoreFiles:files=>{state.applyingEdits=true;try{for(const original of files){const f=state.files.find(f=>f.uri===original.uri);if(f){f.text=original.text;}}}finally{state.applyingEdits=false;}state.revision++;state.buildDirty=false;renderTabs();scheduleAnalysis();},
 commitBuild:result=>{state.image=result.image;state.assembly=result.assembly;state.result=result;state.ilDump=null;state.buildDirty=false;applyAnalysis(result);renderTabs();},
 cursor:()=>{const p=editor.sourceSnapshot().positionAt(editor.offset);return {uri:editor.uri,line:p.line+1,column:p.character+1};},download,toast,render:renderPanel,selectFrame:selectDebugFrame,showNext:showNextStatement});


const lazyFeatures=createStudioLazyFeatures({state,docking,runtime,compiler,documents:workbenchServices.documents,
 designerDiagnostics:projectServices.diagnostics,
 commands:commandRegistry,$,toast,download,explorerContext,chooseExplorer,openFile,applyEdits,requestCompiler,
 renderTree,saveLocal,loadDiskRecords,launch,stopQuietly,resetEditors,renderWorkspace,status,nativeSourceChanges,
 renderTabs,refreshEngineIndicators,setEditorDecorations,renderPanel,openDecompilerFile,setPanel,invokeAssembly,
 showModal,closeModal,ask,commitWizardPlan,
 onNativeJob:(job,options)=>backgroundTasks?.nativeJob(job,options),
 onNativeJobFailure:(id,error,options)=>backgroundTasks?.nativeFailure(id,error,options)});
designerTools=lazyFeatures.designer;
const workbench=lazyFeatures.assembly,nativeBuild=lazyFeatures.native,ilDebugger=lazyFeatures.disassembly;
const projectWizard=lazyFeatures.wizard;
$('#exception-mode').value=state.debugSettings.exceptionBreak;
function nativeSourceChanges(){return state.nativeMode?state.files.filter(f=>f.nativeHash&&f.text!==f.nativeBaseline).map(f=>({path:f.uri,text:f.text,expectedHash:f.nativeHash})):[];}
async function invokeAssembly(bytes,methodToken,args=[],{debug=false,stopOnEntry=true,recordHistory=true,maxHistory,maxHistoryBytes,pdb=null,sources={}}={}){await stopQuietly();state.programOutput='';state.frameId=null;log(`Invoking managed CIL method 0x${Number(methodToken).toString(16)} · bounded worker · explicit session network policy`);ilDebugger.reset();state.lastManagedLaunch={assembly:bytes,managedIL:true,pdb,sources,methodToken,arguments:args,...state.debugSettings,...runtimeBridge.launchOptions({projectId:projectServices.currentProjectId}),functionBreakpoints:state.functionBreakpoints,debug,stopOnEntry:debug&&stopOnEntry,recordHistory,maxHistory,maxHistoryBytes,exceptionBreak:state.debugSettings.exceptionBreak};setPanel(debug?'disassembly':'output');return runtime.request('launch',state.lastManagedLaunch);}
async function openAssemblyExplorer(bytes=state.assembly){if(state.nativeMode&&!bytes){setPanel('assembly');return;}if(!bytes){const built=await build();bytes=built?.assembly;}if(!bytes)throw new Error('Build or open a managed assembly first');setPanel('assembly');const summary=await workbench.open(bytes);if(state.panel==='assembly')renderPanel();return summary;}
async function applyRefactoring(action){if(state.readOnly)throw new Error('Stop execution before editing');const revision=state.revision;for(const e of action.edits)if(state.files.find(f=>f.uri===e.uri)?.version!==e.version)throw new Error('The refactoring is stale. Request it again.');const validated=await requestCompiler('validateRefactoring',{action});if(revision!==state.revision)throw new Error('Source changed during refactoring validation; no edits were applied');for(const change of validated.changes){const file=state.files.find(f=>f.uri===change.uri);if(!file||file.text!==change.previous)throw new Error('Refactoring snapshot mismatch');}applyEdits(action.edits);toast(action.title);}
async function focusLanguageDocument(params={}) {
 if(params.uri&&params.uri!==state.active)await openLocation({uri:params.uri,start:params.offset??0});
 else if(Number.isInteger(params.offset))editor?.goto(params.offset,params.end??params.offset);
}
async function codeActions(params={}) {
 await focusLanguageDocument(params);
 return editor?.runCommand('View.ShowSmartTag');
}
async function extensionsDialog(){const config=await ask('Generators & analyzers',`<div class="notice">Built-in JavaScript extensions run in the compiler worker. This is not Roslyn generator/analyzer DLL loading.</div><p><label><input id="ext-build" type="checkbox"> Generate GeneratedBuildInfo.Version()</label></p><p><label><input id="ext-analyze" type="checkbox"> Unreferenced-local and empty-catch analyzers</label></p><div class="form-row"><label for="ext-version">Generated version</label><input id="ext-version" value="0.9.0"></div><div class="form-row"><label for="ext-schema">Optional JSON field schema (generates a class)</label><textarea id="ext-schema" rows="4" style="width:100%" placeholder='{"name":"Customer","fields":[{"name":"Id","type":"int"}]}'></textarea></div>`,'Apply and build',()=>{const text=$('#ext-schema').value.trim();if(text)JSON.parse(text);return {buildInfo:$('#ext-build').checked,analyzers:$('#ext-analyze').checked,version:$('#ext-version').value,schema:!!text,schemaProperties:!!$('#extension-properties')?.checked,additionalFiles:text?[{uri:'model.schema.json',text}]:[]};});if(!config)return;state.extensionConfig=config;await requestCompiler('configureExtensions',config);saveLocal();state.buildDirty=true;await build();}
function generatedSourcesDialog(){const generated=state.result?.generatedSources??[];showModal('Generated sources (read-only)',generated.length?generated.map(f=>`<h3>${E(f.uri)}</h3><pre>${E(f.text)}</pre>`).join(''):'<p>No generated sources. Enable a built-in generator under Tools → Generators & analyzers.</p>',{wide:true});}
function activeFile(){return state.files.find(f=>f.uri===state.active);}
function requestCompiler(method,params={},options){return projectServices.request(method,params,options);}
function formatBytes(bytes=0){if(bytes<1024)return `${bytes} B`;if(bytes<1048576)return `${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;return `${(bytes/1048576).toFixed(1)} MB`;}
function time(){return new Date().toLocaleTimeString([], {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function log(text,type='system'){state.logs.push({text,type,time:time()});if(state.logs.length>300)state.logs.shift();renderPanel('output');}
function toast(message,type='info'){const el=document.createElement('div');el.className='toast '+type;el.textContent=message;const host=$('#toasts');host.append(el);while(host.children.length>4)host.firstElementChild.remove();setTimeout(()=>el.remove(),5500);}
function status(message,kind='ready'){const el=$('#status-state');el.innerHTML=icon(kind==='error'?'warning':kind==='paused'?'bug':kind==='running'?'play':'check')+' '+E(message);}
function saveSoon() {
 clearTimeout(state.saveTimer);
 if (state.nativeMode) { refreshEngineIndicators(); return; }
 if (!canRecoverStudioWorkspace(workbenchServices.documents, state.extraFiles)) {
  $('#status-saved').textContent = 'Modified · use Save or Save As for large files';
  return;
 }
 $('#status-saved').innerHTML = icon('save') + ' Saving…';
 state.saveTimer = setTimeout(saveLocal, 250);
}

function recoveryData(){const c=explorerContext();return {...sessionRecovery.export(),langVersion:state.langVersion,format:'sharpforge-project',version:1,name:state.projectSystem?.solution?.name??state.name,extensions:state.extensionConfig,folders:state.folders,mode:state.workspaceMode,membershipDirty:state.membershipDirty,configuration:state.configuration,startupProject:state.startupProject,entry:state.projectSystem?.solution?.path,diskRecords:c.records.map(f=>({...f,bytes:undefined,base64:f.bytes?encodeBase64(f.bytes):undefined})),files:state.files,active:state.active,tabs:state.tabs,breakpoints:state.breakpoints,functionBreakpoints:state.functionBreakpoints,watches:state.watches,theme:document.documentElement.dataset.theme};}
function savePrevious() {
 return storeStudioRecovery({ documents: workbenchServices.documents, extraFiles: state.extraFiles,
  storage, key: storageKeys.previous, capture: recoveryData,
  onError: error => toast('Previous workspace recovery could not be saved: ' + error.message, 'error') });
}
function saveLocal() {
 if (state.nativeMode) { refreshEngineIndicators(); return false; }
 const saved = storeStudioRecovery({ documents: workbenchServices.documents, extraFiles: state.extraFiles,
  storage, key: storageKeys.workspace, capture: recoveryData });
 if (saved) $('#status-saved').innerHTML = icon('check') + ' Saved locally';
 else $('#status-saved').textContent = 'Recovery unavailable · use Save or Save As';
 return saved;
}

function recover(){try{const project=JSON.parse(storage.getItem(storageKeys.workspace));if(project?.format!=='sharpforge-project'||project.version!==1||!Array.isArray(project.files)||!project.files.every(f=>typeof f.uri==='string'&&typeof f.text==='string'))return false;
 validateStudioSources(project.files);const records=project.diskRecords?.map(r=>({...r,bytes:r.base64?Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)):undefined}))??[...(project.extraFiles??[]),...project.files.map(f=>({path:f.uri,text:f.text}))];validateFilePlan({records,folders:project.folders??[]},[]);
 state.extraFiles=records.filter(r=>!/\.cs$/i.test(r.path)||typeof r.text!=='string');state.folders=project.folders??[];state.workspaceMode=project.mode??'solution';state.membershipDirty=project.membershipDirty??false;state.configuration=project.configuration??'Debug';state.startupProject=project.startupProject??null;state.disk=new DiskWorkspace(records);
 if(project.entry){state.projectSystem=new ProjectSystem(records,{configuration:state.configuration,maxFiles:20000});state.projectSnapshot=state.projectSystem.load(project.entry);}
 state.langVersion=/^(?:[1-9]|1[0-4]|preview)$/.test(project.langVersion)?project.langVersion:'14';state.name=project.name??'Application';state.extensionConfig=project.extensions??null;state.files=project.files.map((f,i)=>({...f,version:Date.now()+i}));state.active=project.active??state.files[0]?.uri??'';state.tabs=project.tabs?.filter(t=>state.files.some(f=>f.uri===t))??(state.active?[state.active]:[]);state.breakpoints=project.breakpoints??{};state.functionBreakpoints=project.functionBreakpoints??[];state.watches=project.watches??[];if(project.theme==='light')document.documentElement.dataset.theme='light';projectServices.sync();sessionRecovery.restore(project);runtimeBridge.select(null);return true;
 }catch{return false;}}

function studioBuiltInContext() {
 return {
  state, documents: workbenchServices.documents, builds: workbenchServices.builds,
  withLoad: withWorkspaceLoad, samples, nativeBuild, stopQuietly, savePrevious,
  confirmLeaveNative: studioWorkspaceContext().confirmLeaveNative,
  compiler: () => compiler, openAssembly: openAssemblyExplorer, resetEditors, renderWorkspace,
  runtimeBridge, recent: () => recentWorkspaces, saveLocal, build, applyAnalysis, log, formatBytes
 };
}
function loadSample(id, initial = false, options = {}) {
 return loadStudioSample(id, initial, options, studioBuiltInContext());
}

function refreshEngineIndicators(){
 const native=state.nativeMode,job=state.nativeJob,errors=(state.result?.diagnostics??[]).filter(d=>d.severity==='error').length,warnings=(state.result?.diagnostics??[]).filter(d=>d.severity==='warning').length;
 $('.target-select').innerHTML='<span class="dot purple"></span> '+(native?'Local MSBuild · browser IL debugger':'Managed browser VM');
 const config=$('.config-select');config.dataset.command=native?'nativeMSBuild':'profile';config.innerHTML=E(native?'MSBuild settings':'Debug')+' <span>⌄</span>';
 $('.title-project').innerHTML=E(state.name)+' <span>—</span> <span>'+ (native?'Native SDK/MSBuild workspace':'JavaScript C# toolchain')+'</span>';
 $('#compilation-mode').textContent=native?'native process':'worker';$('#metric-files').previousElementSibling.textContent=native?'Open source files':'Source files';$('.metric-caption').textContent=native?'native operation wall time':'latest analysis';
 $('#heap-size').closest('section').style.display=native&&!state.debug?'none':'';$('.execution-section').style.display=native&&!state.debug?'none':'';
 if(!native)return;
 $('#compile-ms').textContent=job?.ended?Math.max(0,Date.parse(job.ended)-Date.parse(job.started)).toFixed(0):'—';$('#timing-fill').style.width='0%';$('#metric-files').textContent=state.files.length;$('#metric-tokens').textContent='—';$('#metric-bytecode').textContent='—';$('#metric-errors').textContent=errors;
 $('#error-count').textContent=errors;$('#error-count').classList.toggle('has-errors',errors>0);$('#inline-diagnostics').innerHTML='<span class="dot '+(errors?'red':warnings?'purple':'green')+'"></span> '+(job?`${errors} errors · ${warnings} warnings`:'Not built');
 if(!state.debug){$('#session-title').textContent=job?'Native MSBuild '+job.status:'Native workspace';$('#session-subtitle').textContent='SDK compilation is separate from browser language services';$('#session-tag').textContent=job?job.status.toUpperCase():'LOCAL';$('#session-dot').className='session-dot';$('#status-message').textContent='Native builds run with your OS permissions; browser language services are a subset';}
 const dirty=nativeSourceChanges().length+nativeBuild.sourceChanges().length;$('#status-saved').textContent=dirty?dirty+' unsaved native file(s)':'Disk snapshots current';
}
function renderWorkspace(){
 projectServices.sync();sessionUI?.refresh();
 $('.title-project').innerHTML=E(state.name)+' <span>—</span> <span>JavaScript C# toolchain</span>';$('.solution-heading b').textContent=`Solution '${state.name}'`;$('#project-name').textContent=state.name;$('#file-count').textContent=`(${state.files.length} files)`;
 if(!state.files.some(f=>f.uri===state.active))state.active=state.files[0]?.uri;if(!state.tabs.includes(state.active))state.active&&state.tabs.push(state.active);
 renderTree();renderTabs();const file=activeFile();if(file&&editor&&editor.model!==workbenchServices.documents.models.get(file.uri))editor.setModel(file.uri,workbenchServices.documents.models.get(file.uri));renderBreadcrumb();setEditorDecorations();renderPanel();refreshEngineIndicators();updateDebugButtons();
}
function renderTree(){solutionExplorer.render();}

function renderTabs(){
 docking.sync(state.files,state.tabs,state.active);
 for(const file of state.files)docking.title('source:'+file.uri,(state.dirtyFiles.has(file.uri)?'● ':'')+file.uri.split('/').at(-1));
 if(state.active)editor=editors.get(state.active)??editor;
}
function openFile(uri,offset=null,end=offset,view={}){
 const file=workbenchServices.documents.get(uri);if(!file)return;workbenchServices.reveal.userIntent();
 const token=navigation.beforeOpen({uri,offset,view});let opened=false;
 try{
  if(!state.tabs.includes(uri))state.tabs.push(uri);state.active=uri;
  const panelId=view.panelId??(view.viewId&&view.viewId!=='primary'?[...docking.tabs.views]
   .find(([,value])=>value.uri===uri&&value.viewId===view.viewId)?.[0]:null)??'source:'+uri;
  if(!docking.layout.panels.has(panelId))renderTabs();docking.layout.open(panelId);
  editor=workbenchServices.documents.views.get(uri)?.get(view.viewId??'primary')?.editor??editors.get(uri);
  if(!editor){docking.host.contents.delete('source:'+uri);docking.content.delete('source:'+uri);docking.host.render();editor=editors.get(uri);}
  if(editor.model!==workbenchServices.documents.models.get(uri))editor.setModel(uri,workbenchServices.documents.models.get(uri));
  editor.setReadOnly(workbenchServices.locks.isDocumentLocked(uri));renderTree();renderBreadcrumb();setEditorDecorations();
  if(offset!==null)editor.goto(offset,end);opened=true;saveSoon();
 }finally{navigation.afterJump(token,{record:opened});navigationButtons();}
}
function renderBreadcrumb(){
 $('#breadcrumb-file').innerHTML='<span class="file-icon">C#</span>'+E(state.active??'');const symbols=state.result?.symbols.filter(s=>s.uri===state.active&&s.kind!=='local'&&!s.name.startsWith('<'))??[];
 $('#symbol-nav').innerHTML='<option value="">Navigate to symbol</option>'+symbols.map(s=>`<option value="${s.start}">${E((s.owner?s.owner+'.':'')+s.name+(s.kind==='method'?'(…)':''))}</option>`).join('');
}
function matchesDebugSource(uri){const file=state.files.find(f=>f.uri===uri),embedded=state.debugSources.get(uri);return !!file&&typeof embedded==='string'&&embedded===file.text;}
function setEditorDecorations(){for(const [uri,instance]of editors){
 instance.setDiagnostics(workbenchServices.diagnostics.query({uri,deduplicate:true}));
 const current=state.debug&&!state.buildDirty&&state.debug.profile!=='managed-il',bound=current?state.debug.breakpoints?.filter(b=>b.uri===uri):null;
 const bps=(state.breakpoints[uri]??[]).map(request=>{const binding=bound?.find(b=>b.requestedLine===request.line&&(b.requestedColumn??1)===(request.column??1));return {...(binding??{...request,verified:current?false:undefined}),muted:state.debugSettings.breakpointsEnabled===false};});instance.setBreakpoints(bps);
 const point=state.debug?.state==='paused'?state.debug.point:null,frame=[...(state.inspectedThreadFrames??[]),...(state.debug?.frames??[])].find(f=>f.id===state.frameId),selected=frame&&frame.id!==state.debug.frames[0]?.id?frame:null;
 const snapshot=instance.sourceSnapshot(),painted=point?.uri===uri&&matchesDebugSource(uri)?{...point,start:snapshot.offsetAt({line:point.line-1,character:point.column-1}),end:snapshot.offsetAt({line:(point.endLine??point.line)-1,character:(point.endColumn??point.column+1)-1})}:null;instance.setExecutionLocation(painted,{phase:state.debug?.reason?.phase,description:state.debug?.reason?.description});
 instance.setSelectedFrameLine(selected?.source===uri&&matchesDebugSource(uri)?selected.line:null);
 }debugTools?.updateBanner();}
function showNextStatement(){if(state.debug?.state!=='paused')return;state.inspectedThreadFrames=null;state.inspectedThreadId=null;state.frameId=state.debug.frames[0]?.id??null;state.inspectedLocals=null;const point=state.debug.point;if(point&&matchesDebugSource(point.uri)){openFile(point.uri);editor.gotoLine(point.line,point.column);}else if(point&&state.debugSources.has(point.uri))advancedTools.showSymbolSource(point);else if(state.debug.profile==='managed-il')setPanel('disassembly');setEditorDecorations();renderPanel('stack');refreshWatches();}
async function selectDebugFrame(id){if(!['paused','waiting'].includes(state.debug?.state))return;const frame=[...(state.inspectedThreadFrames??[]),...state.debug.frames].find(f=>f.id===id);if(!frame)return;state.frameId=id;const sessionId=state.debug.sessionId,locals=await runtime.request('locals',{frameId:id,sessionId});if(state.debug?.sessionId!==sessionId||state.frameId!==id||!['paused','waiting'].includes(state.debug.state))return;state.inspectedLocals=locals;if(frame.source&&matchesDebugSource(frame.source)){openFile(frame.source);editor.gotoLine(frame.line,frame.column);}setEditorDecorations();renderPanel('stack');renderPanel('debug');if(state.debug.profile==='managed-il')renderPanel('disassembly');await refreshWatches();}


function scheduleAnalysis(){
 if(state.nativeMode||[...workbenchServices.documents.models.values()].some(model=>model.buffer.length>8*1024*1024))return;
 clearTimeout(state.analyzeTimer);state.analyzeTimer=setTimeout(analyze,250);
}
function analyze(){return execution.analyze();}
function applyAnalysis(result,projectId=workbenchServices.builds.activeId){
 if(projectId!==workbenchServices.builds.activeId)return;result={diagnostics:[],symbols:[],metrics:{},...result};
 const extra=projectErrors().filter(d=>!result.diagnostics.some(r=>r.code===d.code&&r.message===d.message));if(extra.length)result={...result,success:false,diagnostics:[...result.diagnostics,...extra],metrics:{...result.metrics,errors:(result.metrics.errors??0)+extra.length}};
 if(result.pdb)state.pdb=result.pdb;state.result=result;const m=result.metrics;$('#compile-ms').textContent=(m.totalMs??m.compileMs??0).toFixed(1);$('#timing-fill').style.width=Math.min(100,Math.max(2,(m.totalMs??m.compileMs??0)/50*100))+'%';$('#metric-files').textContent=m.files??state.files.length;$('#metric-tokens').textContent=(m.tokens??0).toLocaleString();$('#metric-bytecode').textContent=(m.instructions??0).toLocaleString();$('#metric-errors').textContent=m.errors??0;$('#metric-errors').style.color=m.errors?'var(--red)':'var(--green)';
 const errors=result.diagnostics.filter(d=>d.severity==='error').length;$('#error-count').textContent=errors;$('#error-count').classList.toggle('has-errors',errors>0);const warnings=result.diagnostics.filter(d=>d.severity==='warning').length;$('#inline-diagnostics').innerHTML=`<span class="dot ${errors?'red':warnings?'purple':'green'}"></span> ${errors?errors+' '+(errors===1?'error':'errors'):warnings?warnings+' '+(warnings===1?'warning':'warnings'):'No issues'}`;
 if(!state.debug||['terminated','faulted'].includes(state.debug.state)){status(errors?`${errors} compiler errors`:'Ready',errors?'error':'ready');$('#session-title').textContent=errors?'Build needs attention':'Compiler ready';$('#session-subtitle').textContent=errors?'Open Error List to inspect diagnostics':`${state.files.length} files · ${m.methods??0} compiled methods`;$('#session-tag').textContent=errors?'ERROR':'READY';$('#session-dot').className='session-dot'+(errors?' error':'');}
 setEditorDecorations();renderBreadcrumb();renderTree();renderPanel('problems');renderPanel('bytecode');renderPanel('outline');renderPanel('generated');
}
function build(silent=false){return execution.build(silent);}
function launch(debug=true,options={}){return execution.launch(debug,options);}
function stopQuietly(){return execution.stop({all:true});}
function stopActiveSession(){return execution.stop();}
async function step(mode){const reverse=['stepBack','reverseContinue'].includes(mode);if(state.debug?.state!=='paused'&&!(reverse&&['terminated','faulted'].includes(state.debug?.state))){if(['next','stepIn'].includes(mode)&&state.debug?.state!=='running')return launch(true,{stopOnEntry:true});return;}await runtime.request(reverse?mode:'resume',reverse?{}:{mode});}
async function runToCursor(){const position=editor.sourceSnapshot().positionAt(editor.offset),target={uri:state.active,line:position.line+1,column:position.character+1};if(state.debug?.state==='paused'){if(!matchesDebugSource(target.uri))throw new Error('The active document does not match the source embedded in this debug assembly');return runtime.request('runToCursor',target);}return launch(true,{runToCursor:target,stopOnEntry:false});}
const renderedSessionStates=new Map();
const runtimeReveals=createStudioRuntimeReveals({reveals:execution.reveals,state,matchesSource:matchesDebugSource,
 openSource:point=>{openFile(point.uri);editor.gotoLine(point.line,point.column);},
 showSymbolSource:point=>advancedTools?.run(()=>advancedTools.showSymbolSource(point)),setPanel,renderPanel});
let lastDebugKey='',panelFrame=0;
function renderPanelSoon(){if(panelFrame)return;panelFrame=requestAnimationFrame(()=>{panelFrame=0;for(const id of ['output','debug','stack','breakpoints'])renderPanel(id);});}
function runtimeEvent(event){
 if(event.event==='state'&&!event.stats){updateDebugButtons();setEditorDecorations();return;}
 if(event.appId&&event.appId!==workbenchServices.sessions.activeId)return;if(event.event==='state'&&event.sessionId!==undefined){if(event.sessionId!==(state.runtimeSession??0)){lastDebugKey='';state.watchEpoch=(state.watchEpoch??0)+1;objectRequest++;}state.runtimeSession=event.sessionId;}
 if(event.event==='ui'){advancedTools?.onUI(event.commands);return;}
 if(event.event==='loaded'){state.runtimeSession=event.sessionId;state.debugSources=new Map(event.sources.filter(s=>typeof s.text==='string').map(s=>[s.uri,s.text]));state.immediateHistory=[];return;}
 if(event.event==='output'){renderPanelSoon();return;}
 if(event.event==='error'||event.event==='runtimeerror'){toast(event.message,'error');return;}
 if(event.event!=='state')return;
 const previous=renderedSessionStates.get(event.appId);renderedSessionStates.set(event.appId,event);if(event.profile==='managed-il'&&state.lastManagedLaunch)state.lastManagedLaunch.instructionBreakpoints=(event.breakpoints??[]).filter(b=>!b.source).map(({instructionReference,condition,conditionMode,hitCondition,logMessage,enabled,oneShot})=>({instructionReference,condition,conditionMode,hitCondition,logMessage,enabled,oneShot}));advancedTools?.onState(event);workbenchServices.locks.refresh();updateDebugButtons();refreshEngineIndicators();updateRuntimeMetrics(event);
 const key=(event.sessionId??0)+':'+event.state+':'+event.stats.instructions+':'+JSON.stringify(event.locals?.map(v=>v.value));
 if(event.state==='paused'&&key!==lastDebugKey){state.inspectedLocals=null;state.inspectedThreadFrames=null;state.inspectedThreadId=null;state.frameId=event.frames[0]?.id??null;runtimeReveals.paused(event);setEditorDecorations();refreshWatches();if(event.profile==='managed-il')renderPanel('disassembly');}
 if((event.state==='faulted'||event.state==='terminated'&&!event.uiActive)&&previous?.state!==event.state){editors.forEach(e=>{e.setExecutionLocation(null);e.setSelectedFrameLine(null);});if(event.state==='faulted'){log(`${event.fault?.type}: ${event.fault?.message}`,'error');}else{log(`Program exited · ${event.stats.instructions.toLocaleString()} instructions · ${event.stats.elapsedMs.toFixed(2)} ms VM time`,'debug');}runtimeReveals.completed(event);state.watchResults.clear();}
 if(event.state==='running'){setEditorDecorations();if(['debug','stack'].includes(state.panel))renderPanelSoon();}
 if(event.state==='paused'||event.state==='running')$('#status-message').textContent=(event.state==='paused'?(event.reason?.description??'Paused'):'Debugging · source snapshot is read-only');else $('#status-message').textContent=state.nativeMode?'Native builds run in a trusted local process; IL debugging runs in browser workers':(state.runtimeSettings?.enabled?'Local managed execution · explicit session networking enabled':'Local managed execution · networking denied');
 if(event.profile==='managed-il'&&event.state!=='running')renderPanel('disassembly');
 if(event.state!=='running'){setEditorDecorations();renderPanel('breakpoints');if(state.panel==='debug-session'||state.panel==='immediate')renderPanel(state.panel);}debugTools.updateBanner();runtimeTools?.update();if(event.state==='paused')runtimeReveals.symbols(event);lastDebugKey=key;
}
function updateDebugButtons(){const current=state.debug?.state??'idle',paused=current==='paused',running=['running','waiting'].includes(current),active=paused||running||current==='ready'||state.debug?.uiActive,busy=!!execution.launchController||state.launchBusy||state.controlBusy||state.hotEdit;
 $('#start-label').textContent=state.hotEdit?'Apply changes':busy?'Working…':paused?'Continue':state.debug?.uiActive?'Application running':'Start';$('#start').disabled=busy||running||state.debug?.uiActive&&!paused||(state.nativeMode&&!paused);$('#pause').disabled=!running;$('#stop').disabled=!active&&!busy;$('#restart').disabled=busy||!state.debug;
 ['step-over','step-in'].forEach(id=>$('#'+id).disabled=busy||running||(state.nativeMode&&!paused));$('#step-out').disabled=busy||!paused;$('#step-back').disabled=busy||running||!state.debug?.history?.count;
 $('.statusbar').classList.toggle('debugging',paused);$('.statusbar').classList.toggle('running',running);
 if(paused)status('Paused · '+(state.debug.reason?.reason??'break'),'paused');else if(running)status('Running','running');else if(current==='faulted')status('Runtime exception','error');else if(state.debug?.uiActive)status('Application running · waiting for input','running');else if(current==='terminated')status('Execution completed');}

function updateRuntimeMetrics(d){const h=d.stats.heap;const [size,unit]=formatBytes(h.liveBytes).split(' ');$('#heap-size').innerHTML=E(size)+' <small>'+E(unit)+'</small>';const percent=h.liveBytes/h.maxBytes*100;$('#heap-percent').textContent=percent<.1&&percent>0?'<0.1%':percent.toFixed(1)+'%';$('#heap-fill').style.width=(h.liveBytes?Math.max(1,percent):0)+'%';$('#heap-objects').textContent=h.liveObjects.toLocaleString();$('#heap-collections').textContent=h.collections;$('#heap-reclaimed').textContent=formatBytes(h.freedBytes);$('#heap-pause').textContent=h.collections?h.lastPauseMs.toFixed(2)+' ms':'—';$('#vm-time').textContent=d.stats.elapsedMs.toFixed(2)+' ms';$('#vm-instructions').textContent=d.stats.instructions.toLocaleString();$('#vm-depth').textContent=d.stats.frames;$('#vm-history').textContent=d.history.count;$('#il-load-ms').textContent=d.assemblyLoad?d.assemblyLoad.milliseconds.toFixed(2)+' ms'+(d.assemblyLoad.cacheHit?' (cached)':''):'—';$('#il-artifact-size').textContent=d.assemblyLoad?formatBytes(d.assemblyLoad.bytes):'—';
 $('#session-title').textContent=d.uiActive&&d.state==='terminated'?'Application running':{paused:'Execution paused',running:'Program running',terminated:'Execution completed',faulted:'Runtime exception',ready:'Runtime ready'}[d.state]??d.state;$('#session-subtitle').textContent=d.state==='paused'&&d.point?`${d.point.uri}:${d.point.line} · ${d.reason?.reason??'paused'}`:d.state==='faulted'?d.fault?.type:'ECMA-335 IL · tracing GC';$('#session-tag').textContent={paused:'PAUSED',running:'LIVE',terminated:'DONE',faulted:'FAULT'}[d.state]??'READY';$('#session-dot').className='session-dot '+(d.state==='faulted'?'error':d.state==='paused'?'paused':d.state==='running'?'running':'');}
function setPanel(panel){workbenchServices.reveal.userIntent();state.panel=panel;docking.activate(panel);renderPanel(panel);}
function empty(title,body,glyph='info'){return `<div class="empty-state"><span data-icon="${glyph}"></span><div><b>${E(title)}</b><p>${body}</p></div></div>`;}
function renderItemProperties(el){return studioRenderers.renderItemProperties(el);}
function renderPanel(panel=state.panel){const target=panel==='watch'?'debug':panel;const el=docking.content.get(target);if(!el)return;if(workbenchShell?.hasTool(target))return workbenchShell.renderTool(target,el);if(!toolRegistry.definitions().some(tool=>tool.id===target))return;let mount=toolMounts.get(target);if(!mount){mount=toolRegistry.mount(target,el);toolMounts.set(target,mount);}else mount.render();}
async function refreshWatches(){if(state.debug?.state!=='paused'){state.watchResults.clear();return;}const frameId=state.frameId,sessionId=state.debug.sessionId,epoch=state.watchEpoch=(state.watchEpoch??0)+1;const results=await Promise.all(state.watches.map(async expression=>{try{return [expression,await runtime.request('evaluate',{expression,frameId,sessionId})];}catch(error){return [expression,{error:error.message}];}}));if(epoch!==state.watchEpoch||sessionId!==state.debug?.sessionId||frameId!==state.frameId||state.debug?.state!=='paused')return;state.watchResults=new Map(results);renderPanel('debug');}

async function languageRequest(method,params={uri:state.active,offset:editor?.offset??0}){try{if(['save','closeDocument','openDocument','nextDocument','previousDocument','findFiles'].includes(method))return await editorHostCommand(method,params);if(method==='hover'&&state.debug?.state==='paused'&&matchesDebugSource(params.uri)){const file=state.files.find(f=>f.uri===params.uri),offset=params.offset;let start=offset,end=offset;while(start>0&&/[\w]/.test(file.text[start-1]))start--;while(end<file.text.length&&/[\w]/.test(file.text[end]))end++;const expression=file.text.slice(start,end);if(/^[A-Za-z_]\w*$/.test(expression)){const sessionId=state.debug.sessionId,frameId=state.frameId;try{const value=await runtime.request('evaluate',{expression,frameId,sessionId});if(state.debug?.sessionId===sessionId&&state.frameId===frameId)return {contents:expression+' = '+value.result+'\n'+value.type+' · selected paused frame · side-effect-free data tip'};}catch{}}}
 if(method==='callHierarchy'){await showCallHierarchy(params);return;}
 if(method==='codeActions')return await codeActions(params);
 if(method==='format')return await applyRefactoring(await requestCompiler('format',params));
 if(method==='definition'){
  const result=await requestCompiler(method,params);
  if(result)await openLocation({...result,preview:true});else toast('No bound definition at this position.');
  return result;
 }
 if(method==='references'){const refs=await requestCompiler(method,params);showReferences(refs);return refs;}
 if(method==='rename'){
  if(state.readOnly){toast('Stop debugging before renaming.');return;}
  await focusLanguageDocument(params);
  return editor?.runCommand('Refactor.Rename');
 }
 return await requestCompiler(method,params);
 }catch(error){
  if(['hover','completion'].includes(method))return null;
  toast(error.message,'error');
  if(['save','closeDocument','openDocument'].includes(method))return false;
 }
}
function applyEdits(edits){return editorIntegration.apply(edits);}
function sourceDocumentChanged(event){
 if(event.change)state.breakpoints[event.uri]=remapBreakpointChanges(state.breakpoints[event.uri]??[],event.change);
 else if(event.previous!==undefined)state.breakpoints[event.uri]=remapSourceBreakpoints(event.previous,event.record.text,state.breakpoints[event.uri]??[]);
 state.diskRevision++;if(state.applyingEdits)return;saveSoon();scheduleAnalysis();setEditorDecorations();
 designerTools?.sourceSync.sourceChanged(event.uri);workbenchShell?.update();
}
function activeSessionChanged(debug,session,event){
 if(event.type==='selected'){lastDebugKey='';objectRequest++;}
 if(debug&&session)runtimeEvent(legacyRuntimeEvent(session,debug));
 else {updateDebugButtons();setEditorDecorations();renderPanelSoon();}
 if(event.type==='selected'){renderPanel('debug');renderPanel('stack');renderPanel('watch');}
}


function showReferences(refs){state.toolReferences=refs;if(workbenchShell)return workbenchShell.setReferences(refs);setPanel('references');}
function toggleBreakpoint(uri,line){const bps=state.breakpoints[uri]??=[];const existing=sourceBreakpointAt(bps,state.debug?.profile!=='managed-il'&&!state.buildDirty?state.debug?.breakpoints?.filter(b=>b.uri===uri)??[]:[],line);const index=bps.indexOf(existing);if(index>=0)bps.splice(index,1);else bps.push({line,enabled:true});bps.sort((a,b)=>a.line-b.line);syncBreakpoints(uri);setEditorDecorations();renderPanel('breakpoints');saveLocal();}
async function syncBreakpoints(uri){await projectServices.syncBreakpoints(uri);setEditorDecorations();renderPanel('breakpoints');}
async function editBreakpoint(uri,line){const existing=sourceBreakpointAt(state.breakpoints[uri]??[],state.debug?.profile!=='managed-il'&&!state.buildDirty?state.debug?.breakpoints?.filter(b=>b.uri===uri)??[]:[],line)??{line,enabled:true};const value=await debugTools.editRule(existing,`Breakpoint · ${uri}:${existing.line}`,{source:true});if(!value)return;state.breakpoints[uri]??=[];const at=state.breakpoints[uri].indexOf(existing);if(at>=0)state.breakpoints[uri][at]=value;else state.breakpoints[uri].push(value);await syncBreakpoints(uri);saveLocal();setEditorDecorations();renderPanel('breakpoints');}

async function editLocal(local){const expression=await ask(`Edit local · ${local.name}`,`<div class="form-row"><label for="local-value">New value (${E(local.type)})</label><input id="local-value" value="${E(local.value)}" autofocus><small>Expression evaluation is side-effect-free. The result must match the declared type.</small></div>`,'Set value',()=>$('#local-value').value);if(expression===null)return;try{await runtime.request('setVariable',{frameId:state.frameId,name:local.name,expression});await refreshWatches();}catch(error){toast(error.message,'error');}}
async function breakOnWrite(params){try{const info=await runtime.request('dataBreakpointInfo',params);if(!info.dataId)throw new Error(info.description);const existing=(state.debug?.dataBreakpoints??[]).filter(b=>b.verified).map(b=>({...b}));const result=await runtime.request('dataBreakpoints',{breakpoints:[...existing,{dataId:info.dataId}]});const last=result.at(-1);if(!last?.verified)throw new Error(last?.message??'Storage is no longer available');setPanel(state.debug?.profile==='managed-il'?'disassembly':'breakpoints');toast('Break on write: '+info.description);}catch(error){toast(error.message,'error');}}
let objectRequest=0;
async function inspectObject(name,reference,start=0){
 const request=++objectRequest;
 try{const sessionId=state.debug?.sessionId;const children=await runtime.request('children',{reference,start,count:100,sessionId});if(request!==objectRequest||sessionId!==state.debug?.sessionId)return;state.objectContext={reference,children};setPanel('object');const el=docking.content.get('object');
 el.innerHTML=`<div class="panel-tools"><b>${E(name)}</b><span>Handle #${reference.h}:${reference.g}</span><button id="object-first" ${start===0?'disabled':''}>First page</button><button id="object-next" ${children.length<100?'disabled':''}>Next page</button><button id="object-retention">Find retaining path</button></div><table class="data-table"><thead><tr><th>Name</th><th>Value</th><th>Type</th></tr></thead><tbody>${children.map((v,i)=>`<tr data-child="${i}"><td class="name">${v.reference?'▸ ':''}${E(v.name)}</td><td class="value">${E(v.value)}</td><td class="type">${E(v.type)}</td></tr>`).join('')}</tbody></table><div id="retention-path" class="tool-page" role="status"></div>`;
 $('#object-first',el).onclick=()=>inspectObject(name,reference);$('#object-next',el).onclick=()=>inspectObject(name,reference,start+100);
 $('#object-retention',el).onclick=async()=>{try{const result=await runtime.request('retentionPath',{reference});if(request!==objectRequest)return;$('#retention-path',el).textContent=result.reachable?result.path.map(p=>p.label+' → '+p.type).join(' / '):result.truncated?'Traversal budget reached before finding a root.':'No strong managed root currently retains this object.';}catch(error){toast(error.message,'error');}};
 for(const tr of $$('[data-child]',el)){tr.oncontextmenu=e=>{if(state.debug?.state!=='paused')return;e.preventDefault();const v=children[Number(tr.dataset.child)];openMenuAt(e.clientX,e.clientY,[['Break on write',()=>breakOnWrite({reference,name:v.name})]]);};tr.onclick=()=>{const v=children[Number(tr.dataset.child)];if(v.reference)inspectObject(name+'.'+v.name,v.reference);};}
 }catch(error){toast(error.message,'error');}
}
function showModal(title,body,{wide=false,footer=null,onClose=null}={}){if(state.modalClose){const previous=state.modalClose;state.modalClose=null;previous();}state.modalClose=onClose;$('#modal').classList.remove('wizard-modal');$('#modal').onkeydown=null;$('#modal').classList.toggle('wide',wide);$('#modal').innerHTML=`<div class="modal-header"><h2 id="modal-title">${E(title)}</h2><button class="mini-button" id="modal-close" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div><div class="modal-footer">${footer??'<button id="modal-done">Close</button>'}</div>`;$('#modal').setAttribute('aria-labelledby','modal-title');$('#modal-backdrop').classList.remove('hidden');hydrate($('#modal'));$('#modal-close').onclick=closeModal;const done=$('#modal-done');if(done)done.onclick=closeModal;setTimeout(()=>($('#modal [autofocus]')??$('#modal input')??$('#modal-close')).focus(),0);}
function closeModal(){if(state.modalBusy)return;const callback=state.modalClose;state.modalClose=null;$('#modal-backdrop').classList.add('hidden');if(callback)callback();editor?.input.focus();}
function ask(title,body,confirm,read){return new Promise(resolve=>{let resolved=false;const finish=value=>{if(resolved)return;resolved=true;state.modalClose=null;closeModal();resolve(value);};showModal(title,body,{footer:`<button id="ask-cancel">Cancel</button><button class="primary" id="ask-confirm">${E(confirm)}</button>`,onClose:()=>finish(null)});$('#ask-cancel').onclick=()=>finish(null);$('#ask-confirm').onclick=()=>{try{const value=read();if(value==='')throw new Error('Enter a value.');finish(value);}catch(error){toast(error.message,'error');}};$$('input',$('#modal')).forEach(input=>input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#ask-confirm').click();}});});}
async function newFile(){return explorerActions.run('new-file',solutionExplorer.selected()[0]??solutionExplorer.model.roots[0]);}
async function renameFile(uri){const node=[...solutionExplorer.model.nodes.values()].find(n=>n.path===uri&&n.kind==='source');return explorerActions.run('rename',node);}
async function deleteFile(uri){const node=[...solutionExplorer.model.nodes.values()].find(n=>n.path===uri&&n.kind==='source');return explorerActions.run('delete',node);}

function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportLegacyProject(){if(state.nativeMode){toast('Export workspace applies to browser projects. Native workspace files remain in their original disk folder. Use Save All to save edited native files.','error');return;}saveLocal();const context=explorerContext(),diskRecords=context.records.map(f=>({path:f.path,...(typeof f.text==='string'?{text:f.text}:f.bytes?{base64:encodeBase64(f.bytes)}:{text:''})}));download(state.name+'.sharpforge.json',JSON.stringify({...sessionRecovery.export(),format:'sharpforge-project',version:1,name:state.name,extensions:state.extensionConfig,files:state.files.map(({uri,text})=>({uri,text})),diskRecords:state.projectSystem?diskRecords:undefined,extraFiles:state.extraFiles,folders:state.folders,entry:state.projectSystem?.solution?.path,startupProject:state.startupProject,configuration:state.configuration,breakpoints:state.breakpoints,functionBreakpoints:state.functionBreakpoints},null,2));toast('Workspace exported with project files and hierarchy.');}
function encodeBase64(bytes){let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);}

function importAssembly(bytes, options = {}) {
 return importStudioAssembly(bytes, options, studioBuiltInContext());
}

function studioImportContext() {
 return {
  state, withLoad: withWorkspaceLoad, loadRecords: loadDiskRecords,
  workspaceSettings, records: () => explorerContext().records, compiler: () => compiler,
  openDecompiler: openDecompilerFile, importAssembly, openAssembly: openAssemblyExplorer
 };
}
function importFiles(input, options = {}) {
 return importStudioFiles(input, options, studioImportContext());
}

function examplesDialog(){showModal('Explore the compiler & runtime',`<div class="notice">These examples execute in the real JavaScript compiler and managed VM. Loading one preserves the previous project in local recovery.</div><div class="sample-list">${samples.map((s,i)=>`<button class="sample-item" data-sample="${s.id}"><span class="sample-glyph">${['{ }','GC','f(n)','!','[ ]',';'][i%6]}</span><span class="sample-details"><b>${E(s.name)}</b><small>${E(s.description)}</small></span><span>›</span></button>`).join('')}</div>`);$$('[data-sample]',$('#modal')).forEach(b=>b.onclick=()=>{closeModal();loadSample(b.dataset.sample);});}
let heapPageState=null,heapRequest=0;
async function inspectHeap({next=false,kind=null}={}){
 setPanel('heap');const el=docking.content.get('heap'),request=++heapRequest;
 if(!state.debug){el.innerHTML=empty('Managed Heap','Run a program to inspect live allocations.');return;}
 try{
  const filter=kind??(next?heapPageState?.kind:null),params={limit:200,kind:filter};if(next&&heapPageState){params.afterHandle=heapPageState.page.next;params.stamp=heapPageState.page.stamp;}
  const page=await runtime.request('heapPage',params),census=await runtime.request('heapCensus');if(request!==heapRequest)return;heapPageState={page,kind:filter};
  el.innerHTML=`<div class="panel-tools"><b>${page.totalLiveObjects} live objects</b><span>${formatBytes(census.bytes)}</span><span class="panel-spacer"></span><select id="heap-kind" aria-label="Heap kind"><option value="">All kinds</option>${['object','array','string','exception','box'].map(k=>`<option value="${k}" ${filter===k?'selected':''}>${k}</option>`).join('')}</select><button id="heap-first">First page / refresh</button><button id="heap-next" ${page.next===null?'disabled':''}>Next page</button><button data-command="collect">Collect</button></div><table class="data-table"><thead><tr><th>Handle</th><th>Type</th><th>Size</th><th>Preview</th></tr></thead><tbody>${page.items.map((r,i)=>`<tr data-heap="${i}"><td class="code">#${r.handle}:${r.generation}</td><td>${E(r.type)}</td><td>${r.size} B</td><td>${E(r.preview)}</td></tr>`).join('')}</tbody></table><details class="tool-page"><summary>Type census · ${census.types.length} types</summary>${census.types.map(t=>`<div>${E(t.type)} · ${t.objects} objects · ${formatBytes(t.bytes)}</div>`).join('')}</details><div class="tool-page">${page.items.length} rows in this page. A changed heap invalidates the next-page cursor. Accounting excludes JavaScript and debugger snapshot overhead.</div>`;
  $('#heap-kind',el).onchange=e=>inspectHeap({kind:e.target.value||null});$('#heap-first',el).onclick=()=>inspectHeap({kind:filter});$('#heap-next',el).onclick=()=>inspectHeap({next:true});
  for(const tr of $$('[data-heap]',el))tr.onclick=()=>{const r=page.items[Number(tr.dataset.heap)];inspectObject(r.type,{h:r.handle,g:r.generation});};
 }catch(error){toast(error.message,'error');}
}

const shortcuts=[['Build solution','Ctrl / ⌘ + Shift + B'],['Start / Continue debugging','F5'],['Run without debugging','Ctrl / ⌘ + F5'],['Stop debugging','Shift + F5'],['Break all','F6'],['Step over','F10'],['Step into','F11'],['Step out','Shift + F11'],['Step back','Alt + F10'],['Completions','Ctrl + Space'],['Go to definition','F12'],['Find all references','Shift + F12'],['Rename bound symbol','F2'],['Find in file','Ctrl / ⌘ + F'],['Undo / Redo','Ctrl / ⌘ + Z / Shift + Z'],['Export project','Ctrl / ⌘ + S'],['Command palette','Ctrl / ⌘ + K']];
function shortcutsDialog(){showModal('Keyboard shortcuts',`<table class="shortcut-table">${shortcuts.map(([name,key])=>`<tr><td>${E(name)}</td><td><kbd>${E(key)}</kbd></td></tr>`).join('')}</table><p>On some keyboards, use Fn with function keys. The toolbar exposes every debug command on touch devices.</p>`);}
function profileDialog(...args){return aboutDialogs.profileDialog(...args);}
function architectureDialog(...args){return aboutDialogs.architectureDialog(...args);}
function aboutDialog(...args){return aboutDialogs.aboutDialog(...args);}

function commandsDialog(){showModal('Command palette',`<input class="command-input" id="command-filter" placeholder="Type a command…" autofocus><div class="command-list" id="command-list"></div>`,{footer:'<span class="muted" style="font-size:10px">Search commands · Enter executes the first match · Escape closes</span>'});const render=()=>{const q=$('#command-filter').value.toLowerCase(),items=commandRegistry.list().filter(c=>c[1].toLowerCase().includes(q));$('#command-list').innerHTML=items.map(([id,name,key],i)=>`<button data-palette="${id}" class="${i===0?'selected':''}">${E(name)}<span>${E(key)}</span></button>`).join('');$$('[data-palette]',$('#modal')).forEach(b=>b.onclick=()=>{closeModal();execute(b.dataset.palette);});};$('#command-filter').oninput=render;$('#command-filter').onkeydown=e=>{if(e.key==='Enter')$('#command-list button')?.click();};render();}

function openMenuAt(x,y,items,options={}){sharedMenu.show({items:items.map(item=>Array.isArray(item)?[item[0],typeof item[1]==='function'?item[1]:()=>execute(item[1]),item[2],item[3]]:item),x,y,...options});}
function closeMenu(){sharedMenu.close(false);$$('[data-menu]').forEach(b=>b.classList.remove('active'));}

async function execute(command){try{return await commandRegistry.execute(command);}catch(error){toast(error.message,'error');}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-command]');if(b&&!b.disabled)execute(b.dataset.command);});
for(const content of docking.content.values())content.addEventListener('click',e=>{const button=e.target.closest('[data-command]');if(button){e.stopPropagation();if(!button.disabled)execute(button.dataset.command);}});
$$('[data-menu]').forEach(button=>button.onclick=()=>{const active=button.classList.contains('active');closeMenu();if(active)return;button.classList.add('active');const rect=button.getBoundingClientRect();openMenuAt(rect.left,rect.bottom,menuRegistry.items(button.dataset.menu));});
$$('[data-panel]').forEach(b=>b.onclick=()=>setPanel(b.dataset.panel));

$('#symbol-nav').onchange=e=>{if(e.target.value!=='')editor.goto(Number(e.target.value));};$('#exception-mode').onchange=()=>debugTools.configure({exceptionBreak:$('#exception-mode').value}).catch(error=>toast(error.message,'error'));
workspaceInputs.bind($('#file-input'),importFiles);
workspaceInputs.bind($('#zip-input'),(files,options)=>openWorkspaceZip(files[0],options));
commandRegistry.configure('open',{execute:()=>workspaceInputs.open($('#file-input'))});
commandRegistry.configure('openZip',{execute:()=>workspaceInputs.open($('#zip-input'))});
$('#modal-backdrop').addEventListener('pointerdown',e=>{if(e.target.id==='modal-backdrop')closeModal();});
const globalKeyDown=e=>{
 if(e.defaultPrevented)return;
 if(!$('#modal-backdrop').classList.contains('hidden')){if(e.key==='Escape'){e.preventDefault();closeModal();}if(e.key==='Tab'){const items=$$('button,input,select,[tabindex="0"]',$('#modal')).filter(el=>!el.disabled);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}return;}
 if(studioKeyboard?.handle(e))return;
 if(e.key==='Escape'){closeMenu();$('#app').classList.remove('explorer-open','tools-open');}
};document.addEventListener('keydown',globalKeyDown);
window.addEventListener('beforeunload',saveLocal);
// Small explicit embedding/test surface; compiler/runtime instances are not exposed for arbitrary host evaluation.
contributeRuntimeAutomation(automation,{get runtimeTools(){return runtimeTools;}});
contributeWorkspaceAutomation(automation,{get runtime(){return runtime;},get openProjectWizard(){return openProjectWizard;},get openItemWizard(){return openItemWizard;},get openWorkspaceZip(){return openWorkspaceZip;},get workspaceZipBytes(){return workspaceZipBytes;},get saveWorkspaceFolder(){return saveWorkspaceFolder;},get explorerContext(){return explorerContext;},get state(){return state;},get workspaceSettings(){return workspaceSettings;},get itemTemplates(){return itemTemplates;},get projectTemplates(){return projectTemplates;},get setEditorKeymap(){return setEditorKeymap;},get editor(){return editor;},get explorerActions(){return explorerActions;},get solutionExplorer(){return solutionExplorer;},get openAssemblyExplorer(){return openAssemblyExplorer;},get invokeAssembly(){return invokeAssembly;},get breakOnWrite(){return breakOnWrite;},get compiler(){return compiler;},get build(){return build;},get requestCompiler(){return requestCompiler;},get saveLocal(){return saveLocal;},get importFiles(){return importFiles;},get loadDiskRecords(){return loadDiskRecords;},get setStartupProject(){return setStartupProject;},get saveToDisk(){return saveToDisk;},get applyRefactoring(){return applyRefactoring;},get editors(){return editors;},get navigation(){return navigation;},get setPanel(){return setPanel;},get importAssembly(){return importAssembly;},get loadSample(){return loadSample;},get launch(){return launch;},get selectDebugFrame(){return selectDebugFrame;},get showNextStatement(){return showNextStatement;},get execute(){return execute;},get openFile(){return openFile;}});
contributeDesignerAutomation(automation,{loadDesigner:()=>designerTools.peek()??designerTools.ensure(),get execute(){return execute;}});
contributeDebuggerAutomation(automation,{get advancedTools(){return advancedTools;},get runtime(){return runtime;},get state(){return state;},get toggleBreakpoint(){return toggleBreakpoint;},get editBreakpoint(){return editBreakpoint;},get renderPanel(){return renderPanel;},get setEditorDecorations(){return setEditorDecorations;},get syncBreakpoints(){return syncBreakpoints;},get launch(){return launch;},get debugTools(){return debugTools;},get step(){return step;}});
contributeMsbuildAutomation(automation,{get nativeBuild(){return nativeBuild;}});
contributeDockingAutomation(automation,{get docking(){return docking;},get state(){return state;}});
window.sharpforge=automation.api;
// Startup runs after workspace tool registrations below.


function toggleTool(id){docking.adapt();const location=docking.layout.locate(id);if(location.kind==='autoHide'){docking.host.autoPanel=docking.host.autoPanel===id?null:id;docking.host.render();}else if(location.kind==='group')docking.layout.close(id);else setPanel(id);}
function projectErrors(){
 const scope=state.projectSystem?.closure(state.startupProject);
 return (state.projectSnapshot?.diagnostics??[]).filter(d=>d.severity==='error'&&(!scope||scope.has(d.path)||d.path===state.projectSnapshot.solution.path)).map(d=>({...d,uri:d.path,start:0,length:1,range:{start:{line:0,character:0},end:{line:0,character:1}}}));
}
function openFolder(options={}){
 return withWorkspaceLoad(async load=>{
  if(typeof window.showDirectoryPicker!=='function')return workspaceInputs.open($('#directory-input'),{load});
  try{
   const handle=await window.showDirectoryPicker({mode:'read'});load.check();
   const disk=await readStudioDirectory(handle,{signal:load.signal});
   return await loadDiskRecords(disk.records,{disk,folders:disk.folders,select:true,load});
  }catch(error){if(error.name!=='AbortError')throw error;return null;}
 },options);
}
function studioWorkspaceContext() {
 return {
  state, documents: workbenchServices.documents, nativeBuild, projectWizard, sessionRecovery, runtimeBridge, workspaceLoads,
  recentWorkspaces, readSource: readStudioSource, projectServices, stopQuietly, savePrevious, scheduleAnalysis,
  currentWorkspaceMetadata:()=>studioWorkspaceMetadata(state), resetEditors, renderWorkspace, renderPanel, saveLocal, log,
  projectErrors, applyAnalysis, build, status, renderTree,
  confirmLeaveNative: () => !(nativeSourceChanges().length || nativeBuild.sourceChanges().length)
   || globalThis.confirm('Leave the native workspace with unsaved source or project XML changes?')
 };
}
function loadDiskRecords(records, options = {}) {
 return loadStudioWorkspace(records, options, studioWorkspaceContext());
}

function setStartupProject(path){return selectStudioStartupProject(path,{services:workbenchServices,projects:projectServices,state,renderWorkspace,renderPanel,save:saveLocal,build});}
function saveToDisk(){return studioSave.disk();}
async function openDecompilerFile(bytes,fileName='Assembly.dll'){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);if(data.length>64*1024*1024)throw new Error('Assembly exceeds 64 MB');
 setPanel('assembly');const summary=await workbench.open(data,{fileName});renderPanel('assembly');log(`Inspected ${fileName} without execution.`);return summary;
}

async function reloadDiskProject(entry) {
 try {
  return await loadDiskRecords(explorerContext().records, {
   entry, startup: state.startupProject, disk: state.disk, preserveDocumentState: true, settings: workspaceSettings()
  });
 } catch (error) { toast(error.message, 'error'); }
}

workspaceInputs.bind($('#directory-input'),async(files,{load})=>
 loadDiskRecords(await readStudioFiles(files,{signal:load.signal}),{select:true,load}));
$('#assembly-file-input').onchange=async e=>{try{for(const file of e.target.files){if(file.size>64*1024*1024)throw new Error('Assembly exceeds 64 MB');await openDecompilerFile(new Uint8Array(await file.arrayBuffer()),file.name);}}catch(error){toast(error.message,'error');}finally{e.target.value='';}};
$('#layout-file-input').onchange=async e=>{try{const file=e.target.files[0];if(file){if(file.size>2_000_000)throw new Error('Layout file exceeds size limit');docking.layout.restore(await file.text());}}catch(error){toast(error.message,'error');}finally{e.target.value='';}};
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>{
 if(!e.dataTransfer?.types.includes('Files'))return;e.preventDefault();
 const items=[...e.dataTransfer.items],files=[...e.dataTransfer.files];
 withWorkspaceLoad(async load=>{
  if(items.length===1&&items[0].getAsFileSystemHandle){
   const handle=await items[0].getAsFileSystemHandle();load.check();
   if(handle?.kind==='directory'){
    const disk=await readStudioDirectory(handle,{signal:load.signal});
    return loadDiskRecords(disk.records,{disk,folders:disk.folders,select:true,load});
   }
  }
  if(files.every(file=>/\.(dll|exe)$/i.test(file.name))){
   for(const file of files){
    if(file.size>64*1024*1024)throw new Error('Assembly exceeds 64 MB');
    const bytes=new Uint8Array(await file.arrayBuffer());load.check();await openDecompilerFile(bytes,file.name);load.check();
   }
  }else return importFiles(files,{load});
 }).catch(error=>{if(error.name!=='AbortError')toast(error.message,'error');});
});
window.addEventListener('beforeunload',e=>{if(nativeSourceChanges().length||nativeBuild.sourceChanges().length){e.preventDefault();e.returnValue='';}});
// Solution Explorer, shared context menus, and editor environment.
function explorerContext(){
 const records=createStudioRecords({state,documents:workbenchServices.documents,nativeBuild});
 const snapshot=state.nativeMode?state.nativeWorkspace?.hierarchy:state.projectSnapshot;
 return {revision:state.revision,mode:state.workspaceMode??'solution',identity:(state.nativeMode?'native:':'preview:')+(state.nativeWorkspace?.root&&state.nativeMode?state.nativeWorkspace.root:(state.projectSystem?.solution?.path??state.name)+':'+(state.workspaceEpoch??0)),name:state.name,native:state.nativeMode,root:state.nativeMode?state.nativeWorkspace?.root:null,client:nativeBuild.client,nativeAvailable:nativeBuild.capabilities?.available,trusted:nativeBuild.settings.trusted&&nativeBuild.capabilities?.trusted,buildBusy:nativeBuild.busy,fileBusy:!!(explorerActions.busy||explorerActions.runningMutation),readOnly:state.readOnly,records,files:records,snapshot,startup:state.nativeMode?state.nativeStartup??nativeBuild.settings.project:state.startupProject,solutionPath:snapshot?.solution?.path?.endsWith('.slnx')?snapshot.solution.path:null,entry:state.projectSystem?.solution?.path,folders:state.nativeMode?state.nativeWorkspace?.folders??[]:state.folders,active:state.active,tabs:state.tabs,breakpoints:state.breakpoints,dirty:[...state.dirtyFiles,...nativeBuild.sourceChanges().map(f=>f.path)],generated:state.result?.generatedSources??[],symbols:state.nativeMode?[]:state.result?.symbols??[]};
}
async function copyText(text){try{await navigator.clipboard.writeText(String(text));toast('Copied to clipboard.');}catch{showModal('Copy text',`<p>Clipboard access is unavailable. Select and copy the text below.</p><textarea class="copy-fallback" aria-label="Text to copy" readonly>${E(text)}</textarea>`);const input=$('.copy-fallback',$('#modal'));input.focus();input.select();}}
async function pathDialog(title,path){return ask(title,`<label class="tool-field">Workspace-relative path<input id="item-path" value="${E(path)}" maxlength="1024" autofocus></label><p class="muted">Use a relative path. Existing files are not overwritten.</p>`,'Apply',()=>validateItemPath($('#item-path').value));}
function pickExistingItems(){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='';input.hidden=true;document.body.append(input);input.onchange=()=>{const files=[...input.files];input.remove();resolve(files);};input.oncancel=()=>{input.remove();resolve([]);};input.click();});}
function chooseExplorer(title,choices){return ask(title,`<label class="tool-field">Workspace item<select id="explorer-choice">${choices.map(p=>`<option value="${E(p)}">${E(p)}</option>`).join('')}</select></label>`,'Add',()=>$('#explorer-choice').value);}
function nodeProperties(nodes){state.itemSelection=nodes.map(n=>({...n,children:undefined}));renderItemProperties(docking.content.get('properties'));}
function showItemProperties(nodes){nodeProperties(nodes);setPanel('properties');}

function mapWorkspacePath(path,mappings){const map=mappings.find(m=>path===m.from||path.startsWith(m.from+'/'));return map?map.to+path.slice(map.from.length):path;}
function commitExplorerRecords(payload) {
 return commitStudioExplorerWorkspace(payload, { ...studioWorkspaceContext(), workspaceSettings });
}
async function refreshNativeExplorer(mappings=[],partial=false){
 const paths=state.files.map(f=>({old:f.uri,path:mapWorkspacePath(f.uri,mappings),file:f})),workspace=await nativeBuild.refresh(),available=new Set(workspace.files.map(f=>f.path));
 const next=[];for(const item of paths){if(!available.has(item.path))continue;const disk=await nativeBuild.client.read(item.path);if(!partial&&item.file.text!==item.file.nativeBaseline&&item.old===item.path){next.push(item.file);continue;}next.push({...item.file,uri:item.path,text:disk.text,nativeHash:disk.hash,nativeBaseline:disk.text,version:item.file.version+1});}
 for(const [uri,instance]of editors)if(!next.some(f=>f.uri===uri)){instance.dispose();editors.delete(uri);}
 state.files=next;state.active=mapWorkspacePath(state.active??'',mappings);state.tabs=state.tabs.map(t=>mapWorkspacePath(t,mappings)).filter(t=>next.some(f=>f.uri===t));state.breakpoints=Object.fromEntries(Object.entries(state.breakpoints).map(([p,b])=>[mapWorkspacePath(p,mappings),b]).filter(([p])=>available.has(p)));
 nativeBuild.buffers.clear();nativeBuild.sourcePath=null;nativeBuild.renderSource(true);state.revision++;state.dirtyFiles.clear();state.applyingEdits=true;try{for(const f of next){const instance=editors.get(f.uri);if(instance&&instance.value!==f.text)instance.setValue(f.text);}}finally{state.applyingEdits=false;}renderWorkspace();
}
async function openExplorerNode(node,{preview=false}={}){
 if(!node)return;if(node.kind==='symbol'){return openLocation({uri:node.path,start:node.start,end:node.end,preview});}if(node.kind==='project'||node.kind==='dependencies'||node.kind==='framework'||node.kind==='package'||node.kind==='reference'||node.kind==='analyzer'){showItemProperties([node]);return;}
 if(node.kind==='generated'){setPanel('generated');return;}
 if(node.kind==='project-reference'){const project=[...solutionExplorer.model.nodes.values()].find(n=>n.kind==='project'&&n.path===node.path);if(project)solutionExplorer.model.reveal(project.id);showItemProperties([node]);return;}
 if(node.kind==='assembly'){const bytes=state.nativeMode?await nativeBuild.client.binary(node.path):explorerContext().records.find(r=>r.path===node.path)?.bytes;if(!bytes)throw new Error('Assembly bytes are not present in this workspace');await openDecompilerFile(bytes,node.path);return;}
 if(state.nativeMode){if(!/\.(cs|csproj|slnx|sln|props|targets|json|txt|md|xml|resx|resw|config|css|html|js|ts|svg|yml|yaml|rsp|editorconfig)$/i.test(node.path))return previewWorkspaceFile(node.path);await nativeBuild.open(node.path);return;}
 if(node.kind==='source'){
  if(!state.files.some(file=>file.uri===node.path)){
   const record=explorerContext().records.find(file=>file.path===node.path);
   if(!record)throw new Error('Source is missing from the selected disk files');
   workbenchServices.documents.add(studioSourceRecord(record));renderWorkspace();
  }
  return openLocation({uri:node.path,preview});
 }
 const record=explorerContext().records.find(r=>r.path===node.path);if(typeof record?.text!=='string'){return previewWorkspaceFile(node.path);}
 const before=record.text,revision=state.revision;const text=await ask('Edit '+node.path,`<p>Browser workspace edit. This does not execute MSBuild. Export the workspace to preserve all project files.</p><textarea id="explorer-text" aria-label="Project or text file source" class="explorer-text" spellcheck="false">${E(before)}</textarea>`,'Apply',()=>$('#explorer-text').value);
 if(text===null||text===before)return;if(revision!==state.revision)throw new Error('Workspace changed while the file was open; no edit was applied');await explorerActions.perform([{kind:'write',path:node.path,text}]);
}
async function explorerProjectCommand(action,node){const path=node?.project??node?.path;
 if(action==='solutionSetStartupProjects'||action==='projectDebugStartNewInstance')return commandRegistry.invoke(action,{projectId:node?.project??node?.path});
 if(action==='edit-project')return openExplorerNode({...node,kind:'project-file',path});
 if(action==='startup'){if(state.nativeMode){state.nativeStartup=path;nativeBuild.settings.project=path;nativeBuild.renderBuild(true);renderTree();toast('Startup/build project selected: '+path);return;}if(path)return setStartupProject(path);toast('The browser workspace is already the startup project.');return;}
 if(state.nativeMode){if(path)nativeBuild.settings.project=path;setPanel('msbuild');return nativeBuild.run(action);}
 if(action==='clean'){state.image=null;state.assembly=null;state.pdb=null;state.result=null;state.buildDirty=true;renderWorkspace();log('Browser build artifacts cleared. Source files were not changed.');return;}
 if(action==='restore'||action==='evaluate')throw new Error('This operation requires the native MSBuild host');
 if(node?.kind==='project'&&path&&path!==state.startupProject)await setStartupProject(path);else return build();
}
const explorerActions=new ExplorerCommands({wizardProject:node=>openProjectWizard({add:true,node}),wizardItem:node=>openItemWizard(node),workspaceAction:(id,node)=>workspaceExplorerAction(id,node),context:explorerContext,windowMenu:()=>dockMenuItems("solution"),menu:options=>sharedMenu.show(options),error:error=>toast(error.message,'error'),notice:toast,copy:copyText,pathDialog,pickFiles:pickExistingItems,choose:chooseExplorer,confirm:(title,paths,note)=>ask(title,`<p>${E(note)}</p><pre>${E(paths.join('\n'))}</pre>`,'Delete',()=>true),properties:showItemProperties,open:openExplorerNode,render:renderTree,commit:commitExplorerRecords,readSource:readStudioSource,
 projectCommandState:(id,node)=>commandRegistry.describe(id,{projectId:node?.project??node?.path}),
 captureDocumentState:uri=>workbenchServices.documents.get(uri)?workbenchServices.documents.captureState(uri):null,
 ownsModel:model=>workbenchServices.documents.ownsModel(model),saveNative:()=>nativeBuild.save(),refreshNative:refreshNativeExplorer,refresh:async()=>{if(state.nativeMode){if(nativeSourceChanges().length||nativeBuild.sourceChanges().length){await nativeBuild.refresh();toast('Tree refreshed. Dirty buffers were preserved. Save or reopen changed files explicitly.');}else await refreshNativeExplorer();}else renderTree();},project:explorerProjectCommand,document:(action,uri)=>{if(action==='popout')return docking.host.popout('source:'+uri);const group=docking.layout.groups().find(g=>g.panels.includes('source:'+uri));if(group)docking.layout.dock('source:'+uri,group.id,'right');}});
const solutionExplorer=new SolutionExplorer($('#solution'),{getData:explorerContext,onOpen:(node,options)=>openExplorerNode(node,options),onCommand:(...args)=>explorerActions.run(...args),onMenu:options=>sharedMenu.show(options),onProperties:nodeProperties,onError:error=>toast(error.message,'error')});explorerActions.host.explorer=solutionExplorer;

function updateKeymapStatus(value={keymap:state.keymap}){let button=document.getElementById('editor-keymap-status');if(!button)return;const label=EDITOR_KEYMAPS.find(k=>k.id===value.keymap)?.label??'Visual Studio';button.textContent=label.replace(' (default)','')+(value.keymap==='vim'?' · '+(value.mode??'normal').toUpperCase():value.mode?.includes('…')?' · '+value.mode:'');button.title='Keyboard profile — '+label;}
function setEditorKeymap(id){if(!EDITOR_KEYMAPS.some(k=>k.id===id))throw new Error('Unknown keyboard profile');state.keymap=id;for(const views of workbenchServices.documents.views.values())for(const {editor:instance}of views.values())if(instance.keymap!==id)instance.setKeymap(id);studioKeyboard?.profile(id);try{storage.setItem(storageKeys.editor,JSON.stringify({keymap:id}));}catch{}updateKeymapStatus({keymap:id,mode:editor?.modalMode});editor?.focus();return id;}

function editorHostCommand(method,params={}){return editorHost(method,params);}
const keymapButton=document.createElement('button');keymapButton.id='editor-keymap-status';keymapButton.setAttribute('aria-label','Change keyboard profile');$('#status-cursor').before(keymapButton);keymapButton.onclick=()=>{const r=keymapButton.getBoundingClientRect();sharedMenu.show({items:EDITOR_KEYMAPS.map(k=>({label:k.label,radio:true,checked:state.keymap===k.id,action:()=>setEditorKeymap(k.id)})),x:r.left,y:r.top-160,anchor:keymapButton});};updateKeymapStatus();



function dockMenuItems(...args){return menuRegistry.items('dockMenuItems',...args);}
function showDockMenu(id,x,y,anchor=null){sharedMenu.show({items:dockMenuItems(id),x,y,anchor,document:anchor?.ownerDocument??document});}

function breakpointItems(...args){return menuRegistry.items('breakpointItems',...args);}
function showBreakpointMenu(uri,line,event){sharedMenu.show({items:breakpointItems(uri,line),x:event.clientX,y:event.clientY,anchor:event.target?.closest('.sf-editor')?.querySelector('.sf-input')??editor?.input,document:event.target?.ownerDocument??document});}
async function pasteEditor(instance){if(instance.input.readOnly)return;let text;try{text=await navigator.clipboard.readText();}catch{text=await ask('Paste',`<p>Clipboard reading is unavailable. Paste into this field, then Insert.</p><textarea id="paste-text" class="explorer-text" autofocus></textarea>`,'Insert',()=>$('#paste-text').value);}if(text!==null&&text!==undefined)instance.insert(text);instance.focus();}
function editorContextItems(...args){return menuRegistry.items('editorContextItems',...args);}
function panelContextItems(...args){return menuRegistry.items('panelContextItems',...args);}
const contextDocuments=new WeakSet();
function installContextDocument(doc){if(contextDocuments.has(doc))return;contextDocuments.add(doc);
 const show=(event,keyboard=false)=>{const target=event.target;if(!target?.closest||target.closest('.sf-menu,#modal-backdrop,.sf-tree'))return;const source=target.closest('[data-source-uri]'),tab=target.closest('[data-dock-tab]'),tool=target.closest('[data-tool]');let items,anchor=target,x=event.clientX,y=event.clientY;
  if(keyboard){const r=target.getBoundingClientRect();x=r.left+Math.min(40,r.width/2);y=r.top+Math.min(30,r.height);}
  if(tab){items=dockMenuItems(tab.dataset.dockTab);}
  else if(source){const instance=editors.get(source.dataset.sourceUri);if(!instance)return;const gutter=target.closest('[data-line]');if(gutter)items=breakpointItems(instance.uri,Number(gutter.dataset.line));else items=editorContextItems(instance);anchor=instance.keymapAdapter?.cm.getInputField()??instance.input;}
  else if(tool)items=panelContextItems(tool.dataset.tool,target);
  if(!items)return;event.preventDefault();event.stopImmediatePropagation();sharedMenu.show({items,x,y,anchor,document:doc});
 };
 doc.addEventListener('contextmenu',event=>show(event),true);doc.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')show(event,true);},true);
}
installContextDocument(document);execution.reveals.install(document);


// Project/solution creation and portable workspace IO. ZIP is data only, never code execution.
function workspaceSettings(){return {...sessionRecovery.export(),langVersion:state.langVersion,name:state.projectSystem?.solution?.name??state.name,mode:state.workspaceMode??(state.projectSystem?'solution':'folder'),entry:state.projectSystem?.solution?.path??undefined,startup:state.startupProject??undefined,configuration:state.configuration,active:state.active,tabs:state.tabs,breakpoints:state.breakpoints,functionBreakpoints:state.functionBreakpoints,extensions:state.extensionConfig};}
async function workspaceSnapshot(){
 const context=explorerContext();if(!context.native)return {records:context.records,folders:context.folders,settings:workspaceSettings()};
 if(nativeBuild.busy)throw new Error('Finish or cancel the native build before exporting');
 // No save is forced by an export. Dirty buffers overlay disk bytes with their original encoding.
 const records=[];let size=0;for(const record of context.records){const bytes=await context.client.binary(record.path);if((size+=bytes.length)>128*1024*1024)throw new Error('Workspace exceeds the 128 MiB ZIP budget');const decoded=decodeWorkspaceFile(record.path,bytes);if(typeof record.text==='string')decoded.text=record.text;records.push(decoded);}
 if(explorerContext().identity!==context.identity||state.revision!==context.revision)throw new Error('Workspace changed during export; retry');
 return {records,folders:context.folders,settings:{...workspaceSettings(),mode:context.solutionPath?'solution':'folder',entry:context.solutionPath??undefined,startup:context.startup&&records.some(r=>r.path===context.startup)?context.startup:undefined}};
}
async function workspaceZipBytes(){return exportWorkspaceZip(await workspaceSnapshot());}
async function exportProject(){const bytes=await workspaceZipBytes();download(state.name+'.zip',bytes,'application/zip');toast('Workspace ZIP saved with source, project XML, assets, empty folders, and debugger settings.');return bytes;}
async function saveWorkspaceFolder(){if(typeof window.showDirectoryPicker!=='function')throw new Error('This browser does not expose writable directory handles. Save as ZIP and extract it instead.');let handle;try{handle=await window.showDirectoryPicker({mode:'readwrite'});}catch(error){if(error.name==='AbortError')return null;throw error;}const snapshot=await workspaceSnapshot();try{const result=await writeNewDirectory(handle,{...snapshot,records:[...snapshot.records,workspaceManifestRecord(snapshot.settings,snapshot.records)]});toast('Saved '+result.written.length+' files to the empty destination folder.');return result;}catch(error){toast(error.message+(error.written?.length?' Completed files: '+error.written.join(', '):''),'error');throw error;}}
function openWorkspaceZip(file, options = {}) {
 return openStudioWorkspaceZip(file, options, studioImportContext());
}

async function prepareWizard(node){if(state.readOnly)throw new Error('Stop debugging before creating files');if(state.nativeMode){for(const path of new Set([node?.project,node?.kind==='project'?node.path:null,explorerContext().startup,explorerContext().solutionPath].filter(Boolean))){if(!nativeBuild.buffers.has(path)){const file=await nativeBuild.client.read(path);nativeBuild.buffers.set(path,{...file,baseline:file.text});}}}}
async function openProjectWizard({add=false,node=null}={}){await prepareWizard(node);return projectWizard.openProject({add,node});}
async function openItemWizard(node=null){await prepareWizard(node);return projectWizard.openItem(node);}
async function commitWizardPlan(plan,{add,kind,context,node}){
 if(explorerContext().identity!==context.identity)throw new Error('Workspace changed; reopen the wizard');
 if(state.readOnly)throw new Error('Stop debugging before applying the plan');
 if(!add&&kind==='project'){
  if((state.dirtyFiles.size||state.membershipDirty)&&!globalThis.confirm('Replace this workspace? Export a ZIP first to retain unsaved files. Local recovery keeps the previous workspace.'))throw new Error('Creation cancelled; current workspace was preserved');
  const opened=await loadDiskRecords(plan.records,{entry:plan.entry,startup:plan.startup,folders:plan.folders,name:plan.name,mode:plan.entry?/\.(slnx|sln)$/.test(plan.entry)?'solution':'project':'folder'});if(!opened)throw new Error('Creation cancelled; native workspace and dirty buffers were preserved');
 }else{
  validateFilePlan(plan,explorerContext().records);for(const edit of plan.modifications??[]){if(explorerContext().records.find(r=>r.path===edit.path)?.text!==edit.expectedText)throw new Error('Project XML changed: '+edit.path);}
  explorerActions.operationIdentity=context.identity;explorerActions.readSet=new Map((plan.modifications??[]).map(e=>[e.path,e.expectedText]));
  if(['solution-folder','solution'].includes(node?.kind)&&context.solutionPath&&!plan.modifications?.length){const original=explorerContext().records.find(r=>r.path===context.solutionPath)?.text;if(typeof original==='string'){let text=original;for(const record of plan.records)text=addSolutionItem(text,{solutionPath:context.solutionPath,path:record.path,folder:node.solutionFolder??'Solution Items'});plan.modifications.push({path:context.solutionPath,text,expectedText:original});explorerActions.readSet.set(context.solutionPath,original);}}
  const ops=[...plan.records.map(r=>({kind:'create',path:r.path,text:r.text})),...plan.folders.filter(p=>!plan.records.some(r=>r.path.startsWith(p+'/'))&&!explorerContext().folders.includes(p)).map(path=>({kind:'mkdir',path})),...(plan.modifications??[]).map(r=>({kind:'write',path:r.path,text:r.text}))];
  await explorerActions.perform(ops);
  if(!state.nativeMode&&kind==='project'&&plan.entry&&plan.entry!==state.projectSystem?.solution?.path){await commitExplorerRecords({records:explorerContext().records,folders:state.folders,entry:plan.entry});}
  if(plan.startup){if(state.nativeMode){state.nativeStartup=plan.startup;nativeBuild.settings.project=plan.startup;}else if(!state.startupProject)state.startupProject=plan.startup;}
 }
 if(plan.openFile?.endsWith('.cs'))await openExplorerNode({kind:'source',path:plan.openFile});renderTree();saveLocal();log('Created '+plan.records.length+' files from '+plan.template+'.');
 if(plan.profile==='winui-web')docking.reset('winui');
}
async function workspaceExplorerAction(id,node){
 if(id==='save-zip')return exportProject();if(id==='save-folder')return saveWorkspaceFolder();
 if(id==='open-workspace-entry'){const record=explorerContext().records.find(r=>r.path===node.path);if(!record)throw new Error('Project/solution file is not present');if(state.nativeMode){nativeBuild.settings.project=node.path;return nativeBuild.open(node.path);}return loadDiskRecords(explorerContext().records,{entry:node.path,folders:state.folders,name:node.label});}
 if(id==='convert-sln'){const text=await explorerActions.readText(node.path),converted=convertLegacySolution(text,node.path);await explorerActions.perform([{kind:'create',path:converted.path,text:converted.text}]);toast(converted.warnings.join(' ')||'Created SLNX; original SLN retained.');return;}
 if(id==='import-project')return importExistingProject();
}
async function importExistingProject(){
 const context=explorerContext();if(!context.solutionPath)throw new Error('Open a .slnx solution before adding an external project');
 const source=await ask('Add Existing Project','<p>Keep all project sources, imports, references and assets together.</p><label class="tool-field">Source<select id="existing-source"><option value="current">Project already in this workspace</option><option value="zip">Import a project or solution ZIP</option><option value="folder">Import a containing folder</option></select></label>','Choose',()=>$('#existing-source').value);if(!source)return;
 if(source==='current'){const choices=context.records.filter(r=>r.path.endsWith('.csproj')&&!(context.snapshot?.solution?.projectPaths??[]).includes(r.path)).map(r=>r.path);if(!choices.length)throw new Error('No unlisted project files; import a ZIP or folder first');const path=await chooseExplorer('Add Existing Project',choices);if(path){const text=await explorerActions.readText(context.solutionPath);await explorerActions.perform([{kind:'write',path:context.solutionPath,text:addSolutionProject(text,{solutionPath:context.solutionPath,projectPath:path})}]);}return;}
 const files=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.multiple=source==='folder';if(source==='zip')input.accept='.zip';else input.webkitdirectory=true;input.onchange=()=>resolve([...input.files]);input.oncancel=()=>resolve([]);input.click();});if(!files.length)return;
 const result=await importStudioExistingProject(files,source,{
  workspace:context,current:explorerContext,documents:workbenchServices.documents,explorer:explorerActions,
  choose:chooseExplorer,pathDialog
 });
 if(result)toast('Imported '+result.count+' files; selected project added to the solution.');
}
async function previewWorkspaceFile(path){const c=explorerContext(),bytes=c.native?await c.client.binary(path):c.records.find(r=>r.path===path)?.bytes;if(!bytes)throw new Error('File bytes unavailable');const image=/\.(png|jpe?g|gif|webp)$/i.test(path),url=image?URL.createObjectURL(new Blob([bytes])):null;showModal(path,`<p>${bytes.length.toLocaleString()} bytes. Previewing does not execute this file.</p>${url?`<img src="${E(url)}" alt="${E(path)}" style="max-width:100%;max-height:55vh">`:`<pre>${Array.from(bytes.slice(0,256),b=>b.toString(16).padStart(2,'0')).join(' ')}${bytes.length>256?' …':''}</pre>`}`,{footer:'<button id="download-workspace-file">Save file</button><button id="modal-done">Close</button>',onClose:()=>{if(url)URL.revokeObjectURL(url);}});$('#download-workspace-file').onclick=()=>download(path.split('/').at(-1),bytes,'application/octet-stream');}


mountStudioComposition({
  document, window, state, services: workbenchServices, projects: projectServices,
  commands: commandRegistry, menus: menuRegistry, docking, editorIntegration, execution, studioSave,
  getEditor: () => editor, getDesigner: () => designerTools.peek(), nativeBuild, diskObserver,
  explorer: {context: explorerContext, actions: explorerActions, view: solutionExplorer, openNode: openExplorerNode},
  navigation, openLocation, newFile, pathDialog, languageRequest, requestCompiler, download, applyEdits,
  importFiles, setKeymap: setEditorKeymap, setPanel, openFile, toast, renderWorkspace, renderTree,
  renderPanel, renderPanelSoon, setEditorDecorations, refreshEngineIndicators, saveLocal, saveSoon,
  onStatus: message => { $('#status-message').textContent = message; },
  storage, storageKeys, samples, beginWorkspaceLoad, loadDiskRecords, loadSample, openFolder,
  workspaceInputs, workspaceLoads, watchWindows, advancedTools, runtimeTools, lazyFeatures, studioServices,
  automation, recover, build, stopActiveSession, launch,
  publish: owners => {
    ({editorHost, sessionUI, workbenchShell, studioKeyboard, backgroundTasks, testCodeLens, recentWorkspaces} = owners);
  }
});

function showCallHierarchy(params) {
  return workbenchShell.openCallHierarchy(params).catch(error => toast(error.message, 'error'));
}

// A token-bearing local host URL connects, but never trusts or starts a project automatically.
nativeBuild.autoConnect().catch(error=>toast(error.message,'error'));
