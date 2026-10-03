"""Ordinary DLL/edited CIL, generator and refactoring browser acceptance checks."""
import json,os,subprocess,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1];checks=[];errors=[];server=None
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {arithmeticLibrary,managedFixture} from './tests/managed-fixtures.js';console.log(JSON.stringify({library:[...arithmeticLibrary()],unsupported:[...managedFixture({methods:[{name:'Main',body:(w,c)=>w.op('call',c.member('External.Unavailable','Call','void')).op('ret')} ]})]}));"],cwd=ROOT,text=True, encoding='utf-8'))
def checked(name,action):
 t=time.perf_counter();action();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-t)*1000,2)});print('PASS',name,flush=True)
def truth(value,message='assertion failed'):
 if not value:raise AssertionError(message)
try:
 with sync_playwright() as p, launch_browser(p, __file__) as browser:
  page=browser.new_page(viewport={'width':1536,'height':1050});page.on('pageerror',lambda e:errors.append(str(e)))
  mode='in-memory' if os.getenv('SHARPFORGE_IN_MEMORY')=='1' else 'http'
  load_application(page)
  def open_library():
   before=page.evaluate('sharpforge.getState().files');result=page.evaluate('bytes=>sharpforge.importAssembly(new Uint8Array(bytes))',fixtures['library']);truth(result['workbench']);truth(page.evaluate('sharpforge.getState().files')==before);truth(page.locator('#assembly-code').input_value().find('ldarg.0')>=0)
  checked('ordinary DLL opens in Assembly Explorer without replacing source',open_library)
  def invoke():
   page.locator('#assembly-arguments').fill('[20,22]');page.locator('[data-il-action="invoke"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42');truth(page.evaluate('sharpforge.getState().debug.stats.profile')=='SharpForge.ManagedIL/1')
  checked('selected static method runs in bounded direct-CIL worker',invoke)
  def decompile():
   page.locator('[data-dock-tab="assembly"]').click();page.locator('[data-il-action="csharp"]').click();page.wait_for_function('document.querySelector("#assembly-code")?.value.includes("Reconstructed")');truth('return' in page.locator('#assembly-code').input_value())
  checked('method C# reconstruction is displayed',decompile)
  def edited_il():
   page.locator('[data-il-action="edit"]').click();page.wait_for_function('document.querySelector("#assembly-code")?.value.includes(".image")');area=page.locator('#assembly-code');text=area.input_value();truth(': add' in text);area.fill(text.replace(': add',': mul',1));page.locator('#assembly-arguments').fill('[6,8]');page.locator('[data-il-action="invoke"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug?.returnValue==="48"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='48')
  checked('editable IL is rebuilt and changed arithmetic actually runs',edited_il)
  def full_il():
   page.locator('[data-dock-tab="assembly"]').click();page.locator('[data-il-action="all"]').click();page.wait_for_function('document.querySelector("#assembly-code")?.value.includes("Hello")');text=page.locator('#assembly-code').input_value();truth('Square' in text and 'System.Console::WriteLine' in text)
  checked('all method IL includes resolved signatures and metadata operands',full_il)
  def unsupported():
   page.evaluate('bytes=>sharpforge.inspectAssembly(new Uint8Array(bytes))',fixtures['unsupported']);page.locator('[data-il-action="verify"]').click();page.wait_for_function('document.querySelector(".assembly-message")?.textContent.includes("External")');truth('Call' in page.locator('#assembly-code').input_value())
  checked('unsupported external calls remain inspectable and fail verification',unsupported)
  def malformed():
   message=page.evaluate('async()=>{try{await sharpforge.importAssembly(new Uint8Array([1,2,3]));return "accepted";}catch(e){return e.message;}}');truth(message!='accepted')
  checked('malformed uploaded assembly is rejected',malformed)
  def generators():
   page.evaluate('sharpforge.openFile("Program.cs")');page.locator('[data-source-uri="Program.cs"] .sf-input').fill('Console.WriteLine(GeneratedBuildInfo.Version());');result=page.evaluate('sharpforge.configureExtensions({buildInfo:true,analyzers:true,version:"3.7.0"})');truth(result['success'],str(result.get('diagnostics')));truth(len(page.evaluate('sharpforge.getGeneratedSources()'))==1);page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug?.output.includes("3.7.0")');page.evaluate('sharpforge.execute("generatedSources")');truth('3.7.0' in page.locator('[data-tool=generated]').inner_text());page.evaluate('sharpforge.openFile("Program.cs")')
  checked('source generator binds, executes and appears in read-only generated view',generators)
  def refactor():
   area=page.locator('[data-source-uri="Program.cs"] .sf-input');area.fill('var count=42;\nConsole.WriteLine(count);');page.evaluate('document.querySelector(".source-document:not([hidden]) .sf-input").setSelectionRange(5,5)');area.press('Control+.');page.wait_for_selector('[data-refactor]');page.locator('[data-refactor="0"]').click();page.wait_for_function('document.querySelector(".source-document:not([hidden]) .sf-input").value.startsWith("int count")');area.press('Control+z');page.wait_for_function('document.querySelector(".source-document:not([hidden]) .sf-input").value.startsWith("var count")')
  checked('Ctrl+. refactoring validates, applies and supports editor undo',refactor)
  def format_source():
   area=page.locator('[data-source-uri="Program.cs"] .sf-input');area.fill('class P\n{\nstatic void Main()\n{\nConsole.WriteLine(42);\n}\n}');area.press('Shift+Alt+f');page.wait_for_function('document.querySelector(".source-document:not([hidden]) .sf-input").value.includes("        Console")')
  checked('Shift+Alt+F formats indentation through a versioned action',format_source)
  def visual():
   page.evaluate('bytes=>sharpforge.inspectAssembly(new Uint8Array(bytes))',fixtures['library']);page.evaluate('document.documentElement.style.setProperty("--bottom","430px")');page.wait_for_function('document.querySelectorAll("#toasts .toast").length===0');page.screenshot(path=str(RESULTS/'screenshots/assembly-workbench.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(RESULTS/'screenshots/assembly-workbench-mobile.png'),full_page=True);truth(page.locator('#assembly-code').is_visible());truth(page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  checked('assembly workspace renders at desktop and 390px widths',visual)
  checked('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
except Exception as error:
 checks.append({'name':'acceptance failure','passed':False,'error':str(error)});traceback.print_exc()
finally:
 if server:server.terminate();server.wait(timeout=10)
 report={'version':'0.4.0','mode':os.getenv('SHARPFORGE_IN_MEMORY')=='1' and 'in-memory real modules and workers' or 'http','checks':checks,'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'errors':errors}
 (RESULTS/'browser-managed-results.json').write_text(json.dumps(report,indent=2)+'\n', encoding='utf-8')
 if report['failed']:raise SystemExit(1)
