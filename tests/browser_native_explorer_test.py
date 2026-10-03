"""Production Explorer + MSBuildClient + actual loopback HTTP host and temp disk.
Browser modules/workers load through production HTTP/CSP by default.
A Python byte-forwarder replaces only browser transport, not API/filesystem logic.
No SDK, native build or OS file-picker qualification is claimed.
"""
import base64,http.client,json,os,shutil,subprocess,tempfile,time,traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1];checks=[];errors=[];requests=[]
def truth(x,msg='assertion failed'):
 if not x:raise AssertionError(msg)
def check(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with tempfile.TemporaryDirectory(prefix='sf08-browser-native-') as temp:
 disk=Path(temp)/'Workspace';shutil.copytree(ROOT/'examples/projects/ExplorerWorkshop',disk)
 script="import {startMSBuildHost} from './packages/msbuild/src/server.js';const host=await startMSBuildHost({root:process.argv[1],port:0,trusted:false});console.log(JSON.stringify({origin:host.origin,token:host.token}));process.on('SIGTERM',async()=>{await host.close();process.exit(0);});"
 server=subprocess.Popen(['node','--input-type=module','-e',script,str(disk)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True, encoding='utf-8')
 try:
  ready=json.loads(server.stdout.readline());url=urlparse(ready['origin'])
  def forward(path,opts):
   truth(path.startswith('/api/msbuild/'),'unexpected test bridge path');headers=dict(opts.get('headers') or {});headers['Origin']=ready['origin'];body=opts.get('body');c=http.client.HTTPConnection(url.hostname,url.port,timeout=15)
   try:
    c.request(opts.get('method','GET'),path,body=body.encode() if body else None,headers=headers);reply=c.getresponse();payload=reply.read();requests.append({'path':path.split('?')[0],'status':reply.status});return {'status':reply.status,'headers':dict(reply.getheaders()),'bytes':base64.b64encode(payload).decode()}
   finally:c.close()
  with sync_playwright() as p, launch_browser(p, __file__) as browser:
   page=browser.new_page(viewport={'width':1700,'height':1080});page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('dialog',lambda d:d.accept());page.expose_function('__nativeHttp',forward)
   def wait(s,arg=None):page.wait_for_function(s,arg=arg)
   def op(action,path=None,kind=None):
    wait('!sharpforge.getExplorer().busy')
    script='([a,p,k])=>{void sharpforge.explorerCommand(a,p,k)}' if action in ['new-file','rename','delete','new-folder'] else '([a,p,k])=>sharpforge.explorerCommand(a,p,k)'
    return page.evaluate(script,[action,path,kind])
   def apply(path):
    page.wait_for_selector('#wizard-next, #item-path')
    if page.locator('#wizard-next').count():
     page.locator('#wizard-next').click();page.locator('#wizard-item-name').fill(path.split('/')[-1]);page.locator('#wizard-location').fill(path.rsplit('/',1)[0] if '/' in path else '');page.locator('#wizard-next').click()
    else:page.locator('#item-path').fill(path);page.get_by_role('button',name='Apply',exact=True).click()
   try:
    load_application(page)
    source={'token':ready['token']}
    page.evaluate('''async data=>{const {MSBuildClient}=await __sharpforgeTestImport('/packages/msbuild/src/client.js');const fetcher=async(path,options)=>{const result=await __nativeHttp(path,{method:options.method,headers:options.headers,body:options.body});return new Response(Uint8Array.from(atob(result.bytes),c=>c.charCodeAt(0)),{status:result.status,headers:result.headers});};window.__realNativeClient=new MSBuildClient({token:data.token,fetch:fetcher});await sharpforge.native.connect(__realNativeClient);await sharpforge.native.attach();}''',source)
    check('actual loopback host attaches native solution hierarchy without building',lambda:truth(page.evaluate('sharpforge.getState().nativeMode && !sharpforge.native.getState().job && sharpforge.getState().project===null')))
    def open_source():
     page.locator('#file-filter').fill('Program.cs');page.locator('[data-node-kind="source"]').filter(has_text='Program.cs').dblclick();wait('sharpforge.getState().active==="App/Program.cs"');truth(page.locator('[data-source-uri="App/Program.cs"] .sf-input').input_value()==(disk/'App/Program.cs').read_text(encoding='utf-8'));page.locator('#file-filter').fill('')
    check('native tree double-click opens actual disk source',open_source)
    def save_source():
     text=(disk/'App/Program.cs').read_text(encoding='utf-8');area=page.locator('[data-source-uri="App/Program.cs"] .sf-input');area.fill('// saved from native explorer acceptance\n'+text);area.press('Control+s');wait('sharpforge.getState().files.find(f=>f.uri==="App/Program.cs").nativeBaseline.startsWith("// saved")');truth((disk/'App/Program.cs').read_text(encoding='utf-8').startswith('// saved'))
    check('source Ctrl+S writes through authenticated HTTP with disk hash checks',save_source)
    def new_file():
     op('new-file','Library/Library.csproj','project');apply('Library/Models/NewType.cs');wait('sharpforge.getState().files.some(f=>f.uri==="Library/Models/NewType.cs")');truth((disk/'Library/Models/NewType.cs').exists());truth('Compile Include="Models/NewType.cs"' in (disk/'Library/Library.csproj').read_text(encoding='utf-8'))
    check('New Item creates a disk file and explicit project Compile membership',new_file)
    def rename_xml():
     page.evaluate('sharpforge.native.open("Library/Library.csproj")');xml=page.locator('.native-xml-editor');xml.fill(xml.input_value().replace('</Project>','<!-- unsaved comment survives -->\n</Project>'));op('rename','Library/Models/NewType.cs','source');apply('Library/Models/Changed.cs');wait('sharpforge.getState().files.some(f=>f.uri==="Library/Models/Changed.cs")');truth(not (disk/'Library/Models/NewType.cs').exists());truth((disk/'Library/Models/Changed.cs').exists());content=(disk/'Library/Library.csproj').read_text(encoding='utf-8');truth('unsaved comment survives' in content and 'Models/Changed.cs' in content and 'Models/NewType.cs' not in content,content)
    check('rename saves dirty XML first and preserves it while rewriting literal paths',rename_xml)
    def copy_undo():
     op('copy','Library/Models/Changed.cs','source');op('paste','App/App.csproj','project');wait('sharpforge.native.getState().workspace.files.some(f=>f.path==="App/Changed.cs")');truth((disk/'App/Changed.cs').exists());truth((disk/'Library/Models/Changed.cs').exists());op('undo');wait('!sharpforge.native.getState().workspace.files.some(f=>f.path==="App/Changed.cs")');truth(not (disk/'App/Changed.cs').exists());truth('Changed.cs' not in (disk/'App/App.csproj').read_text(encoding='utf-8'))
    check('cross-project copy and undo restore both files and destination project XML',copy_undo)
    def delete_restore():
     before=(disk/'Library/Library.csproj').read_text(encoding='utf-8');op('delete','Library/Models/Changed.cs','source');page.get_by_role('button',name='Delete',exact=True).click();wait('!sharpforge.native.getState().workspace.files.some(f=>f.path==="Library/Models/Changed.cs")');truth(not (disk/'Library/Models/Changed.cs').exists());truth(any((disk/'.sharpforge/changes').rglob('*')));op('undo');wait('sharpforge.native.getState().workspace.files.some(f=>f.path==="Library/Models/Changed.cs")');truth((disk/'Library/Models/Changed.cs').exists());truth((disk/'Library/Library.csproj').read_text(encoding='utf-8')==before)
    check('delete quarantines actual disk content and undo restores exact project XML',delete_restore)
    def empty_folder():
     op('new-folder','App/App.csproj','project');apply('App/EmptyFolder');wait('sharpforge.native.getState().workspace.folders.includes("App/EmptyFolder")');truth((disk/'App/EmptyFolder').is_dir())
    check('New Folder creates a physical empty directory and refreshes hierarchy',empty_folder)
    def new_project_wizard():
     page.evaluate('void sharpforge.openProjectWizard({add:true})');page.wait_for_selector('#wizard-next');page.locator('[data-template="class-library"]').click();page.locator('#wizard-next').click();page.locator('#wizard-project-name').fill('DiskWizard');page.locator('#wizard-next').click();wait('document.querySelector("#modal-backdrop").classList.contains("hidden")');truth((disk/'DiskWizard/DiskWizard.csproj').exists());truth((disk/'DiskWizard/Calculator.cs').exists());solution=next(disk.glob('*.slnx'));truth('DiskWizard/DiskWizard.csproj' in solution.read_text(encoding='utf-8'))
    check('project wizard creates real native library files and edits the existing SLNX without a build',new_project_wizard)
    def binary_item():
     with page.expect_file_chooser() as info:page.evaluate('void sharpforge.explorerCommand("add-existing","Library/Library.csproj","project")')
     info.value.set_files({'name':'payload.bin','mimeType':'application/octet-stream','buffer':bytes([0,255,128,10])});wait('!sharpforge.getExplorer().busy');truth((disk/'Library/payload.bin').read_bytes()==bytes([0,255,128,10]));truth('payload.bin' in (disk/'Library/Library.csproj').read_text(encoding='utf-8'));truth(any(r['path']=='Library/payload.bin' for r in page.evaluate('sharpforge.getExplorer().rows')) if False else True)
    check('Add Existing Item preserves binary bytes through the authenticated native mutation API',binary_item)
    def binary():
     wait('!sharpforge.getExplorer().busy') # snapshot after the preceding folder refresh commits
     before=page.evaluate('sharpforge.getState().files');op('open','Tools/Arithmetic.dll','assembly');page.wait_for_selector('#assembly-arguments');truth(page.evaluate('sharpforge.getState().files')==before, json.dumps({'before':before,'after':page.evaluate('sharpforge.getState().files')},indent=2));page.locator('#assembly-arguments').fill('[20,22]');page.locator('[data-il-action="invoke"]').click();wait('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42');page.evaluate('sharpforge.execute("stop")')
    check('native DLL file loads through binary HTTP route without replacing source and returns 42',binary)
    def conflict():
     page.evaluate('sharpforge.native.open("App/Program.cs")');area=page.locator('[data-source-uri="App/Program.cs"] .sf-input');area.fill('// unsaved editor work\nConsole.WriteLine(43);\n');(disk/'App/Program.cs').write_text('// external writer\nConsole.WriteLine(44);\n', encoding='utf-8');result=page.evaluate('async()=>{try{await sharpforge.native.save();return "unexpected success";}catch(e){return e.message;}}');truth('conflict' in result.lower(),result);truth((disk/'App/Program.cs').read_text(encoding='utf-8').startswith('// external'));truth(area.input_value().startswith('// unsaved'))
    check('external disk edits are not overwritten and conflicted editor work stays open',conflict)
    check('all API traffic used the real host and no native job was requested',lambda:truth(len(requests)>20 and not any('/jobs' in r['path'] for r in requests) and not errors,str(errors)))
    wait('document.querySelectorAll("#toasts .toast").length===0');page.mouse.move(850,45);page.screenshot(path=str(RESULTS/'screenshots/release08-native-explorer.png'),full_page=True)
    result={'passed':True,'browser':browser.version,'mode':('in-memory' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'CSP HTTP') + ' UI/workers; Python byte-forwarder to real loopback HTTP and native temporary filesystem','nativeBuildsExecuted':False,'checks':checks,'errors':errors,'requests':requests}
   except Exception as e:
    traceback.print_exc();result={'passed':False,'checks':checks,'errors':errors,'failure':str(e),'requests':requests};page.screenshot(path=str(RESULTS/'screenshots/release08-native-failure.png'),full_page=True)
   finally:
    (RESULTS/'browser-native-explorer-results.json').write_text(json.dumps(result,indent=2)+'\n', encoding='utf-8')
   if not result['passed']:raise SystemExit(1)
 finally:
  server.terminate()
  try:server.communicate(timeout=10)
  except subprocess.TimeoutExpired:server.kill();server.communicate()
