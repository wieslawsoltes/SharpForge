"""Production Studio integration with an explicit in-memory native-client test double.
No MSBuild evaluation/build or native HTTP browser navigation is claimed by this suite.
Real HTTP/process contracts are tested in msbuild-native.test.js; real SDK gate is separate.
"""
import json,os,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_in_memory
ROOT=Path(__file__).resolve().parents[1];checks=[];errors=[]
def truth(value,message='assertion failed'):
 if not value: raise AssertionError(message)
def checked(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_EXECUTABLE'),headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1700,'height':1120});page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('dialog',lambda d:d.accept());workers=[];page.on('worker',lambda w:workers.append(w.url))
 try:
  load_in_memory(page)
  fixture={'App/App.csproj':(ROOT/'examples/msbuild/SdkWorkspace/App/App.csproj').read_text(),'App/Program.cs':'// Native disk example\nint answer = 42;\nConsole.WriteLine(answer);\n','Workspace.slnx':'<Solution><Configurations><BuildType Name="Debug"/><BuildType Name="Release"/></Configurations><Folder Name="/src/"><Project Path="App/App.csproj"/></Folder></Solution>','Directory.Build.props':(ROOT/'examples/msbuild/SdkWorkspace/Directory.Build.props').read_text()}
  page.evaluate(r'''({files,assembly})=>{
   const source=new Map(Object.entries(files).map(([path,text])=>[path,{path,text,hash:'h1'}]));let count=0,serial=0;const jobs=new Map();window.__nativeFixture={source,requests:[],slow:false,forceConflict:false};
   const copy=x=>JSON.parse(JSON.stringify(x));const workspace=()=>({root:'/test-double/native-workspace',name:'Native Workspace — transport test double',projects:['App/App.csproj'],solutions:['Workspace.slnx'],files:[...source.keys()].map(path=>({path,size:100,kind:path.endsWith('.cs')?'source':path.endsWith('.csproj')?'project':path.endsWith('.slnx')?'solution':'build'}))});
   const snapshot=job=>{const q=copy(job);if(!window.__nativeFixture.slow&&q.status==='running'){q.status='succeeded';q.exitCode=0;q.ended=new Date().toISOString();job.status=q.status;job.exitCode=0;}
    if(q.status==='succeeded'&&q.request.action==='evaluate')q.result={Properties:{Configuration:q.request.configuration,TargetFramework:'net10.0',Engine:'TEST DOUBLE — not native evaluation'},Items:{Compile:[{Identity:'App/Program.cs',DefiningProjectFullPath:'App/App.csproj'}]}};
    if(q.status==='succeeded'&&q.request.action==='preprocess')q.result={preprocessedText:'<!-- TEST DOUBLE expanded source -->\n<Project />'};
    if(q.status==='succeeded'&&q.request.action==='targets')q.result={targetsText:'Build\nRestore\nCustomTarget\n'};
    return q;};
   window.__nativeFixture.client={connect:async()=>({protocolVersion:1,available:true,trusted:true,engine:'dotnet',version:'MSBuild transport TEST DOUBLE; no SDK execution'}),workspace:async()=>workspace(),read:async path=>{if(!source.has(path))throw Error('Missing fixture file');return copy(source.get(path));},save:async changes=>{if(window.__nativeFixture.forceConflict)throw Error('Disk conflict in test double');for(const c of changes)if(c.expectedHash!==source.get(c.path)?.hash&&c.expectedHash!==null)throw Error('Disk conflict');const written=changes.map(c=>{const hash='h'+(++serial+1);source.set(c.path,{path:c.path,text:c.text,hash});return {path:c.path,hash};});return {written,atomic:false};},start:async request=>{window.__nativeFixture.requests.push(copy(request));const id='job-'+(++count),job={id,status:'running',request:copy(request),started:new Date().toISOString(),ended:null,exitCode:null,signal:null,error:null,events:[{cursor:1,stream:'stdout',text:'TEST DOUBLE: no native tasks executed.\n'}],nextCursor:1,diagnostics:[{severity:'warning',code:'TEST001',message:'Test double diagnostic',file:'App/Program.cs',workspacePath:'App/Program.cs',line:2,column:5}],artifacts:[{path:'App/bin/Fixture.dll',size:assembly.length,kind:'output'}],invocation:{executable:'test-double-not-dotnet',arguments:['msbuild',request.project]},result:null};jobs.set(id,job);return copy(job);},job:async id=>snapshot(jobs.get(id)),cancel:async id=>{const job=jobs.get(id);job.status='cancelled';job.exitCode=null;return copy(job);},artifact:async()=>new Uint8Array(assembly),disconnect:()=>{}};
   return sharpforge.native.connect(window.__nativeFixture.client);
  }''',{'files':fixture,'assembly':list((ROOT/'examples/managed/Arithmetic.dll').read_bytes())})
  checked('native connection does not auto-run or replace browser source',lambda:truth(page.evaluate('!sharpforge.getState().nativeMode && __nativeFixture.requests.length===0')))
  page.evaluate('sharpforge.openTool("msbuild")');page.wait_for_selector('[data-native-setting="project"]')
  checked('native tool, configuration and trust controls are present',lambda:truth(page.locator('[data-native-action]').count()==11 and not page.locator('[data-native-setting="trusted"]').is_checked()))
  def untrusted():
   result=page.evaluate('async()=>{try{await sharpforge.native.run("evaluate");return false;}catch(e){return /trust/.test(e.message);}}');truth(result);truth(page.evaluate('__nativeFixture.requests.length')==0)
  checked('evaluation requires explicit user trust',untrusted)
  page.locator('[data-native-attach]').click();page.wait_for_function('sharpforge.getState().nativeMode')
  page.evaluate('sharpforge.explorerCommand("expand")')
  checked('native workspace replaces source explorer without a preview compilation',lambda:truth(set(fixture).issubset({r.get('path') for r in page.evaluate('sharpforge.getExplorer().rows')}) and page.evaluate('sharpforge.getState().artifact') is None))
  page.evaluate('sharpforge.native.open("App/Program.cs")');page.wait_for_selector('[data-source-uri="App/Program.cs"] .sf-input');area=page.locator('[data-source-uri="App/Program.cs"] .sf-input')
  checked('native C# opens in an independent document editor',lambda:truth(area.input_value()==fixture['App/Program.cs']))
  def save_source():
   area.fill('// modified native source\nint answer = 43;\nConsole.WriteLine(answer);\n');area.press('Control+s');page.wait_for_function('__nativeFixture.source.get("App/Program.cs").text.includes("answer = 43")');truth(page.evaluate('__nativeFixture.requests.length')==0)
  checked('Ctrl+S saves native source rather than exporting a preview project',save_source)
  page.evaluate('sharpforge.native.open("App/App.csproj")');page.wait_for_selector('.native-xml-editor');xml=page.locator('.native-xml-editor')
  checked('raw project editor retains target/task XML',lambda:truth('GenerateBuildTag' in xml.input_value() and '<WriteLinesToFile' in xml.input_value()))
  def save_xml():
   xml.fill(xml.input_value().replace('<OutputType>Exe</OutputType>','<OutputType>Exe</OutputType><!-- saved comment -->'));xml.press('Control+s');page.wait_for_function('__nativeFixture.source.get("App/App.csproj").text.includes("saved comment")')
  checked('project XML edit and save preserves unknown task syntax and comments',save_xml)
  def conflict():
   page.evaluate('__nativeFixture.forceConflict=true');xml.fill(xml.input_value()+'\n');truth(page.evaluate('async()=>{try{await sharpforge.native.save();return false;}catch(e){return e.message.includes("conflict");}}'));truth(page.evaluate('sharpforge.native.getState().dirtyBuffers.length')==1);page.evaluate('__nativeFixture.forceConflict=false');page.evaluate('sharpforge.native.save()')
  checked('save conflicts retain dirty XML buffers',conflict)
  page.evaluate('sharpforge.native.open("Workspace.slnx")');page.wait_for_selector('[data-native-solution-inspect]:enabled');page.locator('[data-native-solution-inspect]').click();page.wait_for_selector('.msbuild-inspector')
  checked('SLNX structure viewer shows folders/configurations and does not run MSBuild',lambda:truth('BuildType' in page.locator('.msbuild-inspector').inner_text() and page.evaluate('__nativeFixture.requests.length')==0))
  def configure_build():
   page.evaluate('sharpforge.openTool("msbuild")');page.locator('[data-native-setting="trusted"]').check();page.locator('[data-native-setting="configuration"]').fill('Release');page.locator('[data-native-setting="framework"]').fill('net10.0');page.locator('[data-native-action="build"]').click();page.wait_for_function('sharpforge.native.getState().job?.status==="succeeded" && !sharpforge.native.getState().busy');r=page.evaluate('__nativeFixture.requests.at(-1)');truth(r['configuration']=='Release' and r['framework']=='net10.0' and r['restore']);truth('TEST DOUBLE' in page.locator('.native-build-output').inner_text())
  checked('build controls send selected configuration/framework and display actual transport log',configure_build)
  checked('native build diagnostics populate shared Error List',lambda:truth(page.evaluate('sharpforge.getState().diagnostics[0].code')=='TEST001'))
  def nav_diag():
   page.locator('[data-native-diagnostic="0"]').click();page.wait_for_function('sharpforge.getState().active==="App/Program.cs"');truth(page.evaluate('sharpforge.getEditorState("App/Program.cs").start')==30)
  checked('build diagnostic navigation selects source line and column',nav_diag)
  def evaluate():
   page.evaluate('sharpforge.native.configure({project:"App/App.csproj"});sharpforge.native.run("evaluate")');page.wait_for_function('sharpforge.native.getState().inspection?.action==="evaluate"');page.wait_for_selector('.native-inspection-filter');truth('net10.0' in page.locator('.msbuild-inspector').inner_text());page.locator('.native-inspection-filter').fill('Compile');truth('Program.cs' in page.locator('.native-evaluation-content').inner_text())
  checked('evaluated properties and item metadata are filterable',evaluate)
  for action in ['preprocess','targets','restore','rebuild','clean','pack','publish','test']:
   def operation(action=action):
    page.evaluate('(action)=>sharpforge.native.run(action)',action);truth(page.evaluate('sharpforge.native.getState().job.request.action')==action)
   checked('native operation wiring: '+action,operation)
  def custom():
   page.evaluate('sharpforge.native.configure({targets:"Prepare;Build",properties:"Feature=enabled",arguments:\'["-warnAsError"]\'});sharpforge.native.run("target")');r=page.evaluate('__nativeFixture.requests.at(-1)');truth(r['targets']==['Prepare','Build'] and r['properties']['Feature']=='enabled' and r['arguments']==['-warnAsError'])
  checked('custom targets, global properties and advanced switches reach transport',custom)
  def cancel():
   page.evaluate('()=>{__nativeFixture.slow=true;window.__longNative=sharpforge.native.run("build");}');page.wait_for_function('sharpforge.native.getState().job.status==="running"');page.evaluate('sharpforge.native.cancel()');page.wait_for_function('!sharpforge.native.getState().busy');truth(page.evaluate('sharpforge.native.getState().job.status')=='cancelled');page.evaluate('__nativeFixture.slow=false')
  checked('cancel updates operation lifecycle and reenables controls',cancel)
  def inspect_binary():
   page.evaluate('sharpforge.native.run("build")');page.evaluate('sharpforge.openTool("msbuild")');page.locator('[data-native-inspect="0"]').click();page.wait_for_selector('#assembly-arguments');truth('Add' in page.locator('[data-tool="assembly"]').inner_text())
  checked('build output loads genuine DLL bytes into Assembly Explorer',inspect_binary)
  def debug_output():
   page.locator('#assembly-arguments').fill('[20,22]');page.locator('[data-il-action="debug"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="paused"');page.keyboard.press('F5');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42')
  checked('native workspace permits F5 continue in its separate ordinary-IL debugger',debug_output)
  checked('native toolbar and metrics do not report stale preview compiler values',lambda:truth('Local MSBuild' in page.locator('.target-select').inner_text() and page.locator('#metric-tokens').inner_text()=='—'))
  def docking():
   page.evaluate('sharpforge.openTool("msbuild");sharpforge.floatPanel("msbuild")');page.wait_for_selector('.sf-dock-floating [data-tool="msbuild"]');truth(page.locator('[data-native-setting="configuration"]').input_value()=='Release');page.evaluate('sharpforge.openTool("project-source");sharpforge.openTool("msbuild-inspector")');truth(page.locator('[data-tool="project-source"]').count()==1 and page.locator('[data-tool="msbuild-inspector"]').count()==1)
  checked('all three MSBuild tools dock independently and retain state when floating',docking)
  def separate_preview():
   page.evaluate('sharpforge.execute("stop")')
   page.locator('#file-input').set_input_files({'name':'Loose.cs','mimeType':'text/plain','buffer':b'Console.WriteLine(42);'})
   page.wait_for_function('!sharpforge.getState().nativeMode && sharpforge.getState().artifact!==null')
   truth([f['uri'] for f in page.evaluate('sharpforge.getState().files')]==['Loose.cs'])
  checked('loose file input switches from native workspace to a separate browser preview',separate_preview)
  def return_native():
   page.evaluate('sharpforge.native.attach();sharpforge.native.open("App/Program.cs")');page.wait_for_function('sharpforge.getState().nativeMode && sharpforge.getState().active==="App/Program.cs"')
   page.locator('#file-input').set_input_files(str(ROOT/'examples/managed/Arithmetic.dll'))
   page.wait_for_selector('#assembly-arguments');truth(page.evaluate('sharpforge.getState().nativeMode'));truth(page.evaluate('sharpforge.getState().files[0].uri')=='App/Program.cs')
  checked('returning to native workspace and opening a DLL through File preserves disk source',return_native)
  checked('two real compiler/runtime workers remain initialized',lambda:truth(len(workers)==2))
  checked('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
  page.evaluate('sharpforge.execute("stop");sharpforge.execute("nativeBuildLayout");sharpforge.native.open("App/App.csproj")');page.wait_for_timeout(300);(ROOT/'docs/screenshots').mkdir(exist_ok=True);page.screenshot(path=str(ROOT/'docs/screenshots/release07-msbuild.png'))
 except Exception:
  traceback.print_exc();raise
 finally:
  (ROOT/'docs/browser-msbuild-results.json').write_text(json.dumps({'passed':not errors and len(checks)>=32,'checks':checks,'errors':errors,'mode':'in-memory production UI with explicit native-client test double; no native engine execution'},indent=2)+'\n');browser.close()
print('Browser MSBuild checks:',len(checks))
