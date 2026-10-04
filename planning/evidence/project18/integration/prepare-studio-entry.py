"""Prepare the protected Studio integration as text; never write or execute the repository entry."""
from pathlib import Path
import difflib
import hashlib
import json
import re

ROOT = Path('/workspace/scratch/3e16369943fd')
INPUT = ROOT / 'p18-studio-integration-main1db/main-1db.js'
EXPECTED = '4925930a42b705578a55c92d89ef8034a780baacec550325d834a992189424ab'
original = INPUT.read_text()
assert hashlib.sha256(original.encode()).hexdigest() == EXPECTED
source = original
changes = []


def replace(label, before, after):
    global source
    count = source.count(before)
    assert count == 1, f'{label}: expected one match, found {count}'
    source = source.replace(before, after, 1)
    changes.append({'label': label, 'before': before, 'after': after})


def section(label, start, end, after):
    assert source.count(start) == 1, label + ': ambiguous start'
    first = source.index(start)
    last = source.index(end, first + len(start))
    replace(label, source[first:last], after.rstrip() + '\n')


replace('P18 public host imports', "import {mountStudioComposition", """import {isWorkspaceTextPath} from '@sharpforge/archive';
import {createWorkspaceSession,workspaceContext} from './workspace-session.js';
import {prepareProjectRequest,projectBuildErrors} from './project-build.js';
import {applyExternalDiskChange,reevaluateDiskWorkspace} from './workspace-disk-events.js';
import {commitWorkspaceWizard} from './workspace-wizard.js';
import {exportWorkspaceToWritable} from './workspace-export.js';
import {createLegacyWorkspaceBundle,workspaceBase64 as encodeBase64} from './workspace-bundle.js';
import {prepareExplorerTypeRename} from './explorer/type-rename.js';
import {workspaceFileNode,navigateWorkspaceDiagnostic} from './workspace-documents.js';
import {applyWorkspaceRefactoring} from './workspace-refactoring.js';
import {applyWorkspaceConflictResolution} from './workspace-conflicts.js';
import {promptWorkspaceSaveConflict} from './workspace-save-conflict.js';
import {restoreLegacyWorkspace} from './workspace-recovery.js';
import {createDesignerMarkupServices} from './designer/markup-services.js';
import {createNativeContextHooks} from './native-build/workspace-state.js';
import {debugSourceForWorkspace,workspaceFileForDebugSource,navigateDebugSource} from './debug-sources.js';
import {decorateDebugEditors} from './debug-editor-decorations.js';
import {createSourceBreakpointController} from './debug-source-breakpoints.js';
import {mountStudioComposition""")

replace('Compiler ownership contribution',
        'getProjectSnapshot:id=>projectServices.snapshot(id),onError:error=>toast(error.message,\'error\'),',
        """getProjectSnapshot:id=>projectServices.snapshot(id),
 requestCompiler:request=>projectServices.compile(request),
 onError:error=>toast(error.message,'error'),""")
replace('Graph launch envelope contribution',
        'launchOptions:()=>({...state.debugSettings,functionBreakpoints:state.functionBreakpoints}),',
        'launchOptions:(projectId,profile,built)=>projectServices.launchOptions(projectId,profile,built),')
replace('Provider save contribution',
        'saveRecovery:saveLocal,canRecover:()=>canRecoverStudioWorkspace(workbenchServices.documents,state.extraFiles),',
        """saveRecovery:saveLocal,canRecover:()=>canRecoverStudioWorkspace(workbenchServices.documents,state.extraFiles),
 saveWorkspace:options=>workspaceSession().save(options),""")
replace('Renderer lazy record access', 'const studioRenderers=createStudioRenderers({',
        """const studioRenderers=createStudioRenderers({
 get explorerContext(){return explorerContext;},
 get loadWorkspaceRecord(){return (path,options)=>workspaceSession().loadRecord(path,options);},""")

replace('Workspace-owned debugger control ports', 'const editors=workbenchServices.documents.editors;', """const editors=workbenchServices.documents.editors;
const debugNavigation={state,openFile,getEditor:()=>editor,
 showSymbolSource:point=>advancedTools.showSymbolSource(point),setPanel};
const sourceBreakpoints=createSourceBreakpointController({state,
 sync:uri=>projectServices.syncBreakpoints(uri),
 decorate:setEditorDecorations,render:renderPanel,save:saveLocal,
 editRule:(...args)=>debugTools.editRule(...args),onError:error=>toast(error.message,'error')});""")
replace('Closed document eviction after docking ownership',
        "if(state.active===uri&&state.tabs.length)openFile(state.tabs.at(-1));}saveLocal();}});",
        """if(state.active===uri&&state.tabs.length)openFile(state.tabs.at(-1));
  workspaceSession().closeRecord(uri).catch(error=>toast(error.message,'error'));
 }saveLocal();}});""")
replace('Shared navigation admission',
        'navigation=new StudioNavigation({docking,getEditor:()=>editor,onChanged:navigationButtons});',
        'navigation=new StudioNavigation({docking,getEditor:()=>editor,onChanged:navigationButtons,prepareDocument:ensureWorkspaceSource});')
replace('Location admission before tab policy',
        'openLocation=createStudioLocationOpener({docking,navigation,openFile});',
        """const revealLocation=createStudioLocationOpener({docking,navigation,openFile});
openLocation=async location=>{
 await ensureWorkspaceSource(location.uri,{signal:location.signal});
 return revealLocation(location);
};""")

replace('Native context and XAML lazy activation ports',
        " designerDiagnostics:projectServices.diagnostics,\n commands:commandRegistry",
        """ designerDiagnostics:projectServices.diagnostics,
 ...createDesignerMarkupServices({state,records:()=>explorerContext().records,
  perform:operations=>explorerActions.perform(operations)}),
 ...createNativeContextHooks({state,documents:workbenchServices.documents,stop:stopQuietly,resetEditors,renderWorkspace,scheduleAnalysis,status,
  getTestInput:({signal}={})=>prepareProjectRequest(state,'analyze',{signal})}),
 getTestProject:()=>state.nativeMode?nativeBuild.contexts?.project??state.nativeStartup:state.startupProject,
 onOpenTestSource:source=>navigateWorkspaceDiagnostic({state,nativeBuild,openFile,setPanel,
  loadRecord:(path,options)=>workspaceSession().loadRecord(path,options)},source),
 scheduleAnalysis,
 commands:commandRegistry""")
replace('Set-next-statement execution identity',
        'cursor:()=>{const p=editor.sourceSnapshot().positionAt(editor.offset);return {uri:editor.uri,line:p.line+1,column:p.character+1};}',
        """cursor:()=>{
  const position=editor.sourceSnapshot().positionAt(editor.offset);
  const source=debugSourceForWorkspace(state,editor.uri);
  if(!source)throw new Error('The active document has no unambiguous matching source in this debug session');
  return {uri:source.uri,line:position.line+1,column:position.character+1};
 }""")

section('Closed-source refactoring through shared document owner', 'async function applyRefactoring(action){',
        'async function focusLanguageDocument(', """async function applyRefactoring(action){
 const result=await applyWorkspaceRefactoring({state,context:explorerContext,request:requestCompiler,applyEdits,
  isReadOnly:file=>state.recoveryReadOnly||file.readOnly||file.generated||
   workbenchServices.locks.isDocumentLocked(file.uri??file.path)},action);
 toast(action.title);
 return result;
}""")
replace('Readonly recovery save scheduling',
        'function saveSoon() {\n clearTimeout(state.saveTimer);',
        'function saveSoon() {\n clearTimeout(state.saveTimer);\n if(state.recoveryReadOnly)return;')
replace('Readonly recovery persistence fence',
        'function saveLocal() {\n if (state.nativeMode)',
        'function saveLocal() {\n if(state.recoveryReadOnly)return false;\n if (state.nativeMode)')
section('Transactional asynchronous recovery', 'function recover(){', 'function studioBuiltInContext()', """async function recover(){
 const result=await restoreLegacyWorkspace({storage,key:storageKeys.workspace,session:workspaceSession(),
  onDiagnostic:diagnostic=>toast(diagnostic.message,'error')});
 return result.restored||result.blocked;
}
""")
replace('No implicit reopened tab after last close',
        "if(!state.files.some(f=>f.uri===state.active))state.active=state.files[0]?.uri;if(!state.tabs.includes(state.active))state.active&&state.tabs.push(state.active);",
        "if(!state.files.some(f=>f.uri===state.active))state.active=state.tabs.find(uri=>state.files.some(file=>file.uri===uri))??'';")
replace('No disposed editor fallback',
        'if(state.active)editor=editors.get(state.active)??editor;',
        "editor=state.active?workbenchServices.documents.views.get(state.active)?.get(workbenchServices.documents.activeViews.get(state.active))?.editor??editors.get(state.active):null;")
replace('Lazy direct file open and cancellation retention',
        'const file=workbenchServices.documents.get(uri);if(!file)return;workbenchServices.reveal.userIntent();',
        """const file=workbenchServices.documents.get(uri);
 if(!file)return /\\.cs$/i.test(uri)?ensureWorkspaceSource(uri).then(()=>openFile(uri,offset,end,view))
  :openExplorerNode(workspaceFileNode(explorerContext(),uri));
 workspaceSession().retainRecord(uri);
 workbenchServices.reveal.userIntent();""")
replace('Intrinsic source readonly alongside session locks',
        'editor.setReadOnly(workbenchServices.locks.isDocumentLocked(uri));renderTree();',
        'editor.setReadOnly(workbenchServices.locks.isDocumentLocked(uri)||file.readOnly||file.generated||state.recoveryReadOnly);renderTree();')

section('Qualified source decorations and diagnostics union',
        'function matchesDebugSource(uri){', 'function showNextStatement(){', """function matchesDebugSource(uri){return !!workspaceFileForDebugSource(state,uri);}
function* sourceEditorEntries(){
 for(const [uri,views]of workbenchServices.documents.views)for(const {editor:instance}of views.values())yield [uri,instance];
}
function setEditorDecorations(){
 return decorateDebugEditors({state,editors:sourceEditorEntries(),
  diagnostics:uri=>workbenchServices.diagnostics.query({uri,deduplicate:true}),
  updateBanner:()=>debugTools?.updateBanner()});
}
""")
replace('Show-next-statement provenance',
        "const point=state.debug.point;if(point&&matchesDebugSource(point.uri)){openFile(point.uri);editor.gotoLine(point.line,point.column);}else if(point&&state.debugSources.has(point.uri))advancedTools.showSymbolSource(point);else if(state.debug.profile==='managed-il')setPanel('disassembly');",
        'navigateDebugSource(debugNavigation,state.debug.point);')
replace('Selected frame provenance',
        'if(frame.source&&matchesDebugSource(frame.source)){openFile(frame.source);editor.gotoLine(frame.line,frame.column);}',
        'navigateDebugSource(debugNavigation,frame);')
replace('Selected-context native analysis',
        'if(state.nativeMode||[...workbenchServices.documents.models.values()].some(model=>model.buffer.length>8*1024*1024))return;',
        'if(state.recoveryReadOnly||state.nativeMode&&!state.nativeProjectContext||[...workbenchServices.documents.models.values()].some(model=>model.buffer.length>8*1024*1024))return;')
replace('Paused run-to-cursor provenance',
        "if(!matchesDebugSource(target.uri))throw new Error('The active document does not match the source embedded in this debug assembly');return runtime.request('runToCursor',target);",
        "const source=debugSourceForWorkspace(state,target.uri);if(!source)throw new Error('The active document has no unambiguous matching source in this debug session');return runtime.request('runToCursor',{...target,uri:source.uri});")
replace('Runtime reveal uses qualified source navigation',
        'openSource:point=>{openFile(point.uri);editor.gotoLine(point.line,point.column);},',
        'openSource:point=>navigateDebugSource(debugNavigation,point),')
replace('Loaded event keeps AppSession descriptor ownership',
        "state.runtimeSession=event.sessionId;state.debugSources=new Map(event.sources.filter(s=>typeof s.text==='string').map(s=>[s.uri,s.text]));state.immediateHistory=[];return;",
        'state.runtimeSession=event.sessionId;state.immediateHistory=[];return;')
replace('Data tip execution identity', 'matchesDebugSource(params.uri)', 'debugSourceForWorkspace(state,params.uri)')
replace('Per-document edit guards', 'function applyEdits(edits){return editorIntegration.apply(edits);}', """function applyEdits(edits){
 if(edits.some(edit=>{
  const file=workbenchServices.documents.get(edit.uri);
  return !file||state.recoveryReadOnly||file.readOnly||file.generated||workbenchServices.locks.isDocumentLocked(edit.uri);
 }))throw new Error('This source document is read-only');
 return editorIntegration.apply(edits);
}""")
section('Breakpoint UI delegates to multi-session binding owner',
        'function toggleBreakpoint(uri,line){', 'async function editLocal(', """function toggleBreakpoint(uri,line){return sourceBreakpoints.toggle(uri,line);}
async function syncBreakpoints(uri){await sourceBreakpoints.sync(uri);setEditorDecorations();renderPanel('breakpoints');}
function editBreakpoint(uri,line){return sourceBreakpoints.edit(uri,line);}
""")

section('Binary/encoding-safe legacy bundle export', 'function exportLegacyProject(){', 'function importAssembly(', """async function exportLegacyProject(){
 const snapshot=await workspaceSnapshot();
 download(state.name+'.sharpforge.json',createLegacyWorkspaceBundle(snapshot));
 toast('Workspace exported with original file encodings and hierarchy.');
}
""")
section('Selected evaluation diagnostics', 'function projectErrors(){', 'function openFolder(',
        'function projectErrors(){return projectBuildErrors(state);}')
replace('Workspace loader delegates through compatible session',
        'return loadStudioWorkspace(records, options, studioWorkspaceContext());',
        'return workspaceSession().load(records, options);')
section('Descriptor-preserving Explorer context', 'function explorerContext(){', 'async function copyText(', """function explorerContext(){
 return workspaceContext(state,{nativeBuild,explorerActions,settings:workspaceSettings(),documents:workbenchServices.documents});
}
""")
replace('Workspace commit delegates through compatible session',
        'return commitStudioExplorerWorkspace(payload, { ...studioWorkspaceContext(), workspaceSettings });',
        'return workspaceSession().commit(payload);')
replace('Lazy binary and text record admission',
        " if(node.kind==='assembly'){const bytes=state.nativeMode?",
        " if(!state.nativeMode&&node.path)await workspaceSession().loadRecord(node.path);\n if(node.kind==='assembly'){const bytes=state.nativeMode?")
replace('Native shared text admission policy',
        "if(!/\\.(cs|csproj|slnx|sln|props|targets|json|txt|md|xml|resx|resw|config|css|html|js|ts|svg|yml|yaml|rsp|editorconfig)$/i.test(node.path))",
        "if(!isWorkspaceTextPath(node.path)&&!/\\.(?:[a-z]*proj|slnx?|slnf)$/i.test(node.path))")
replace('Native wizard/startup context selection',
        "if(action==='startup'){if(state.nativeMode){state.nativeStartup=path;nativeBuild.settings.project=path;",
        "if(action==='startup'){if(state.nativeMode){nativeBuild.contexts.setProject(path);state.nativeStartup=path;nativeBuild.settings.project=path;")
replace('Explorer workspace action arguments',
        'workspaceAction:(id,node)=>workspaceExplorerAction(id,node),',
        'workspaceAction:(...args)=>workspaceExplorerAction(...args),')
replace('Explorer conflict and semantic rename ports',
        'pathDialog,pickFiles:pickExistingItems,choose:chooseExplorer,confirm:',
        """pathDialog,pickFiles:pickExistingItems,choose:chooseExplorer,
 applyConflictResolution:resolution=>applyWorkspaceConflictResolution({context:explorerContext},workspaceSession(),resolution),
 prepareTypeRename:request=>prepareExplorerTypeRename(explorerContext(),requestCompiler,request),confirm:""")
replace('Correct mutation confirmation label',
        "E(paths.join('\\n'))}</pre>`,'Delete',()=>true)",
        "E(paths.join('\\n'))}</pre>`,title==='Delete Items'?'Delete':'Continue',()=>true)")

section('Bounded workspace snapshot through session', 'async function workspaceSnapshot(){', 'async function workspaceZipBytes(){',
        'function workspaceSnapshot(){return workspaceSession().snapshot();}')
section('Writable ZIP export with source ownership fence', 'async function exportProject(){', 'async function saveWorkspaceFolder(){', """async function exportProject(){
 if(typeof window.showSaveFilePicker==='function'){
  let handle;
  try{handle=await window.showSaveFilePicker({suggestedName:state.name+'.zip',
   types:[{description:'Workspace ZIP',accept:{'application/zip':['.zip']}}]});}
  catch(error){if(error.name==='AbortError')return null;throw error;}
  const context=explorerContext();
  const writable=await handle.createWritable();
  const result=await exportWorkspaceToWritable(context,writable,{isCurrent:()=>{
   const current=explorerContext();
   return current.identity===context.identity&&current.revision===context.revision&&current.disk===context.disk;
  }});
  toast('Workspace ZIP saved with original file bytes and settings.');
  return result;
 }
 const bytes=await workspaceZipBytes();
 download(state.name+'.zip',bytes,'application/zip');
 toast('Workspace ZIP saved with original file bytes and settings.');
 return bytes;
}
""")
section('Complete wizard helper with real destination/provider attachment', 'async function commitWizardPlan(',
        'async function workspaceExplorerAction(', """function commitWizardPlan(plan,options){
 return commitWorkspaceWizard({state,actions:explorerActions,nativeBuild,context:explorerContext,
  confirm:message=>globalThis.confirm(message),load:loadDiskRecords,commit:commitExplorerRecords,
  open:openExplorerNode,render:renderTree,save:saveLocal,log,layout:profile=>docking.reset(profile)},plan,options);
}
""")
replace('Workspace watch/recovery action ports', 'async function workspaceExplorerAction(id,node){', """async function workspaceExplorerAction(id,node,payload={}){
 if(id==='reopen-recent-workspace')return workspaceSession().reopenRecent(node?.recent??payload.recent);
 if(id==='disk-external-change')return applyExternalDiskChange({context:explorerContext},workspaceSession(),payload);
 if(id==='disk-reevaluate')return reevaluateDiskWorkspace({context:explorerContext},workspaceSession(),payload);""")
replace('Workspace entry keeps provider identity',
        'return loadDiskRecords(explorerContext().records,{entry:node.path,folders:state.folders,name:node.label});',
        'return loadDiskRecords(explorerContext().records,{entry:node.path,folders:state.folders,name:node.label,disk:state.disk});')
replace('Lazy file preview',
        'async function previewWorkspaceFile(path){const c=explorerContext(),bytes=',
        'async function previewWorkspaceFile(path){if(!state.nativeMode)await workspaceSession().loadRecord(path);const c=explorerContext(),bytes=')

replace('Service-aware workspace/session host', 'mountStudioComposition({\n', """let activeWorkspaceSession;
function workspaceSession(){
 return activeWorkspaceSession??=createWorkspaceSession({state,nativeBuild,editors,documents:workbenchServices.documents,
  workbench:()=>({...studioWorkspaceContext(),workspaceSettings}),
  hasNativeChanges:()=>nativeSourceChanges().length||nativeBuild.sourceChanges().length,
  confirm:message=>globalThis.confirm(message),selectImport:(records,options)=>projectWizard.selectImport(records,options),
  revokeRuntime:()=>runtimeTools.revoke(),stop:stopQuietly,savePrevious,resetEditors,renderWorkspace,
  renderProject:()=>renderPanel('project'),saveLocal,log,projectErrors,applyAnalysis,build,
  ready:text=>{status(text);renderTree();},toast,scheduleAnalysis,
  persistenceReady:()=>solutionExplorer.persistence.ready(),
  isDocumentOpen:path=>[...docking.tabs.views].some(([id,view])=>view.uri===path&&
   (docking.host.popouts.has(id)||docking.layout.locate(id).kind!=='closed')),
  canReleaseDocument:path=>solutionExplorer.canReleaseDocument(path),
  releaseDocumentCaches:path=>solutionExplorer.releaseDocument(path),
  releaseCompilerDocuments:documents=>compiler.request('releaseDocuments',{documents}),
  renderDocuments:()=>{renderTabs();renderTree();renderBreadcrumb();},
  settings:workspaceSettings,context:explorerContext,
  chooseSaveConflict:conflict=>promptWorkspaceSaveConflict({ask,query:$,escapeHtml:E},conflict)
 });
}
async function ensureWorkspaceSource(uri,{signal}={}){
 const present=workbenchServices.documents.get(uri);
 if(present)return present;
 if(state.nativeMode){await nativeBuild.open(uri);return workbenchServices.documents.get(uri);}
 const record=await workspaceSession().loadRecord(uri,{signal});
 if(!record||!/\\.cs$/i.test(uri)||typeof record.text!=='string')throw new Error('Source is unavailable: '+uri);
 const source=workbenchServices.documents.add(studioSourceRecord(record));
 renderWorkspace();
 return source;
}

mountStudioComposition({
  workspaceSession,""")

replace('Workspace ports public composition import',
        "import {createWorkspaceSession,workspaceContext} from './workspace-session.js';",
        "import {workspaceContext} from './workspace-session.js';\n" +
        "import {createStudioWorkspacePorts} from './workbench/studio-workspace-ports.js';")
for imported in [
    "import {applyExternalDiskChange,reevaluateDiskWorkspace} from './workspace-disk-events.js';\n",
    "import {commitWorkspaceWizard} from './workspace-wizard.js';\n",
    "import {exportWorkspaceToWritable} from './workspace-export.js';\n",
    "import {promptWorkspaceSaveConflict} from './workspace-save-conflict.js';\n",
    "import {restoreLegacyWorkspace} from './workspace-recovery.js';\n",
    "import {loadStudioWorkspace} from './workbench/studio-workspace-loader.js';\n",
    "import {commitStudioExplorerWorkspace} from './workbench/studio-explorer-workspace.js';\n",
    "import {importStudioExistingProject} from './workbench/studio-existing-project.js';\n",
    "import {createStudioRecords} from './workbench/workspace-records.js';\n",
]:
    replace('Workspace ports own ' + imported.split('from ')[1].strip(), imported, '')
replace('Workspace bundle public encoding import',
        "import {createLegacyWorkspaceBundle,workspaceBase64 as encodeBase64} from './workspace-bundle.js';",
        "import {workspaceBase64 as encodeBase64} from './workspace-bundle.js';")
replace('File import keeps upstream stream owner',
        "import {importStudioFiles,openStudioWorkspaceZip} from './workbench/studio-file-import.js';",
        "import {importStudioFiles} from './workbench/studio-file-import.js';")
section('Recovery through extracted workspace ports', 'async function recover(){', 'function studioBuiltInContext()',
        'function recover(){return workspacePorts().recover();}')
section('Legacy export through extracted workspace ports', 'async function exportLegacyProject(){', 'function importAssembly(',
        'function exportLegacyProject(){return workspacePorts().exportLegacy();}')
first = source.index('function workspaceSettings(){')
settings = source[first:source.index('\n', first)]
section('Extract workspace action and lifecycle composition',
        '// Project/solution creation and portable workspace IO.', 'mountStudioComposition({',
        settings + """
function workspaceSession(){return workspacePorts().session();}
function workspaceZipBytes(){return workspacePorts().zipBytes();}
function exportProject(){return workspacePorts().exportZip();}
function saveWorkspaceFolder(){return workspacePorts().saveFolder();}
function openWorkspaceZip(file,options){return workspacePorts().openZip(file,options);}
function openProjectWizard(options){return workspacePorts().openProject(options);}
function openItemWizard(node){return workspacePorts().openItem(node);}
function commitWizardPlan(plan,options){return workspacePorts().commitWizard(plan,options);}
function workspaceExplorerAction(id,node,payload){return workspacePorts().action(id,node,payload);}
function importExistingProject(){return workspacePorts().importExistingProject();}
function previewWorkspaceFile(path){return workspacePorts().previewFile(path);}
function ensureWorkspaceSource(uri,options){return workspacePorts().ensureSource(uri,options);}
let activeWorkspacePorts;
function workspacePorts(){
 return activeWorkspacePorts??=createStudioWorkspacePorts({state,documents:workbenchServices.documents,
  nativeBuild,actions:explorerActions,docking,projectWizard,explorer:solutionExplorer,compiler,runtimeTools,
  window,document,storage,storageKey:storageKeys.workspace,context:explorerContext,workbench:studioWorkspaceContext,
  settings:workspaceSettings,nativeSourceChanges,stop:stopQuietly,savePrevious,resetEditors,renderWorkspace,renderPanel,
  saveLocal,log,projectErrors,applyAnalysis,build,status,scheduleAnalysis,renderTabs,renderTree,renderBreadcrumb,
  load:loadDiskRecords,commit:commitExplorerRecords,open:openExplorerNode,confirm:message=>globalThis.confirm(message),
  download,toast,ask,query:$,escapeHtml:E,pathDialog,choose:chooseExplorer,showModal,importContext:studioImportContext
 });
}
""")

for package in ['project-system', 'templates', 'controls', 'editor', 'text', 'bytecode', 'cil']:
    before = f"from '../../packages/{package}/src/index.js'"
    after = f"from '@sharpforge/{package}'"
    if before in source:
        count = source.count(before)
        source = source.replace(before, after)
        changes.append({'label': f'Public {package} import entry ({count})', 'before': before, 'after': after, 'count': count})
replace('Public debugger contract import', "from '../../packages/debugger/src/breakpoints.js'", "from '@sharpforge/debugger'")

replace('Prepared native document context and refresh imports',
        "import {createNativeContextHooks} from './native-build/workspace-state.js';",
        "import {createNativeContextHooks,collectNativeSourceChanges} from './native-build/workspace-state.js';\n" +
        "import {refreshNativeExplorerWorkspace} from './native-build/explorer-refresh.js';")
replace('Native dirty sources use captured document ownership',
        "function nativeSourceChanges(){return state.nativeMode?state.files.filter(f=>f.nativeHash&&f.text!==f.nativeBaseline).map(f=>({path:f.uri,text:f.text,expectedHash:f.nativeHash})):[];}",
        "function nativeSourceChanges(){return collectNativeSourceChanges(state,workbenchServices.documents);}")
section('Native Explorer refresh through Documents adoption',
        'async function refreshNativeExplorer(mappings=[],partial=false){', 'async function openExplorerNode(',
        """function refreshNativeExplorer(mappings=[],partial=false){
 return refreshNativeExplorerWorkspace({state,documents:workbenchServices.documents,nativeBuild,renderWorkspace},
  mappings,{partial,signal:explorerActions.operationController?.signal});
}
""")
replace('Native refresh module owns path remapping',
        "function mapWorkspacePath(path,mappings){const map=mappings.find(m=>path===m.from||path.startsWith(m.from+'/'));return map?map.to+path.slice(map.from.length):path;}\n", '')

for before, after in [
    ("import {studioDiskLimits,validateStudioSources} from './workbench/workspace-limits.js';\n", ''),
    ("import {EditorModel,rebaseEditorSource} from '@sharpforge/editor';", "import {EditorModel} from '@sharpforge/editor';"),
    ("import {importWorkspaceRecords,workspaceManifestRecord,importWorkspaceZip,exportWorkspaceZip,validateWorkspaceSettings,workspaceCandidates,writeNewDirectory,decodeWorkspaceFile,encodeWorkspaceFile,prefixWorkspace,convertLegacySolution} from '@sharpforge/project-system';\n", ''),
    ("import {validateFilePlan,createProjectPlan,createItemPlan,projectTemplates,itemTemplates} from '@sharpforge/templates';", "import {projectTemplates,itemTemplates} from '@sharpforge/templates';"),
    ("import { ProjectSystem, DiskWorkspace, addSolutionProject, addSolutionItem, createCsproj, createSlnx, normalizePath, validateItemPath, parseXml } from '@sharpforge/project-system';", "import {createCsproj,createSlnx,validateItemPath} from '@sharpforge/project-system';"),
    ("import { CodeEditor, escapeHtml as E } from '@sharpforge/editor';", "import {escapeHtml as E} from '@sharpforge/editor';"),
    ("import { SourceText } from '@sharpforge/text';\n", ''),
]:
    replace('Remove extracted import ownership: ' + before.split('from ')[1].strip(), before, after)
redundant = list(re.finditer(r'\n{3,}', source))
if redundant:
    source = re.sub(r'\n{3,}', '\n\n', source)
    changes.append({'label': 'Remove redundant blank lines after extraction',
        'removedLines': sum(len(match[0]) - 2 for match in redundant)})

assert not re.search(r'^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)', source, re.M)
target = ROOT / 'p18-studio-proposed-main1db.js'
target.write_text(source)
patch = ''.join(difflib.unified_diff(original.splitlines(True), source.splitlines(True),
    fromfile='a/apps/studio/studio.js', tofile='b/apps/studio/studio.js'))
(ROOT / 'p18-studio-integration-main1db.patch').write_text(patch)
(ROOT / 'p18-studio-integration-main1db/entry-transformations.json').write_text(json.dumps(changes, indent=2) + '\n')
metadata = {'baseCommit': '1db2e1d540a78403b7aaddcf472311fcde1a81ef', 'baseSha256': EXPECTED,
    'candidateSha256': hashlib.sha256(source.encode()).hexdigest(), 'baseBytes': len(original.encode()),
    'candidateBytes': len(source.encode()), 'baseLines': len(original.splitlines()), 'candidateLines': len(source.splitlines()),
    'transformations': len(changes), 'javascriptExecuted': False, 'repositoryEntryWritten': False}
(ROOT / 'p18-studio-integration-main1db/entry-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps(metadata, indent=2))
