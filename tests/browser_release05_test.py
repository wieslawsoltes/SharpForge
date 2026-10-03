"""Release acceptance using production modules/workers through the same bounded browser harness."""
import json,os,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1];checks=[];errors=[]
def truth(value,message='assertion failed'):
 if not value:raise AssertionError(message)
def checked(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p, launch_browser(p, __file__) as browser:
 page=browser.new_page(viewport={'width':1536,'height':1050});page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  load_application(page)
  def example(id,expected):
   page.evaluate('(id)=>sharpforge.loadSample(id,true)',id);page.wait_for_function('sharpforge.getState().artifact!==null');page.evaluate('sharpforge.run()');page.wait_for_function('(expected)=>sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output===expected',arg=expected)
  checked('auto-property initialization and computed accessor run in production workers',lambda:example('properties','7\n18\n9\n'))
  checked('nested finally runs on return and exception',lambda:example('finally','cleanup\n42\ninner cleanup\nfailure\nouter cleanup\n'))
  checked('loop continue and break execute finally once',lambda:example('finally-loop','cleanup 0\n1\ncleanup 1\ncleanup 2\ndone\n'))
  page.evaluate('sharpforge.execute("stop");sharpforge.openFile("Program.cs")')
  area=page.locator('[data-source-uri="Program.cs"] .sf-input')
  def editor_replace():
   area.fill('int value=1;\nConsole.WriteLine(value);');area.press('Control+h');find=page.locator('.sf-find:not(.hidden)');find.locator('[aria-label="Find in current file"]').fill('value');find.locator('[aria-label="Replace in current file"]').fill('result');find.locator('[data-replace="all"]').click();truth(area.input_value()=='int result=1;\nConsole.WriteLine(result);');area.press('Control+z');truth(area.input_value()=='int value=1;\nConsole.WriteLine(value);');area.press('Escape')
  checked('editor replace-all is literal and one undo operation',editor_replace)
  def goto_line():
   area.press('Control+g');box=page.locator('.sf-goto:not(.hidden) input');box.fill('2:4');box.press('Enter');truth(page.evaluate('sharpforge.getEditorState("Program.cs").start')==16)
  checked('go-to-line resolves line and UTF-16 column',goto_line)
  def brackets():
   area.fill('Console.WriteLine((1+2));');area.evaluate('(e)=>{e.setSelectionRange(17,17);e.dispatchEvent(new KeyboardEvent("keyup"));}');area.press('ArrowRight');truth(page.locator('.sf-bracket-match').count()==2)
  checked('syntax-aware bracket matching highlights actual pair',brackets)
  def expand():
   area.fill('class C{public int X{get;set;}=7;}var c=new C();Console.WriteLine(c.X);');area.evaluate('(e)=>e.setSelectionRange(19,19)');area.press('Control+.');page.wait_for_selector('[data-refactor]');page.locator('[data-refactor]').filter(has_text='Expand auto-property').click();page.wait_for_function('sharpforge.getEditorState("Program.cs").value.includes("private int _x")');truth(page.evaluate('sharpforge.build()')['success']);area.press('Control+z');truth('private int _x' not in area.input_value())
  checked('auto-property expansion validates and editor undo restores original',expand)
  def generators():
   area.fill('var row=new Row();row.Value=42;Console.WriteLine(row.Value);');r=page.evaluate('sharpforge.configureExtensions({schema:true,schemaProperties:true,analyzers:true,additionalFiles:[{uri:"model.schema.json",text:JSON.stringify({name:"Row",fields:[{name:"Value",type:"int"}]})}]})');truth(r['success'],str(r.get('diagnostics')));truth('{ get; set; }' in page.evaluate('sharpforge.getGeneratedSources()[0].text'));page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="42\\n"')
  checked('schema generator emits compiled auto-properties',generators)
  def open_debug():
   page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/Arithmetic.dll'));page.wait_for_selector('#assembly-arguments');page.locator('#assembly-arguments').fill('[20,22]');page.locator('[data-il-action="debug"]').click();page.wait_for_function('sharpforge.getState().debug?.profile==="managed-il" && sharpforge.getState().debug.state==="paused"');page.wait_for_selector('[data-tool="disassembly"] [data-instruction]');truth(page.locator('[data-tool="disassembly"] [data-instruction]').count()==4);truth('02' in page.locator('[data-tool="disassembly"]').inner_text());truth(page.evaluate('sharpforge.getState().debug.frames[0].source') is None)
  checked('disk DLL starts real instruction debugger and docked disassembly',open_debug)
  def conditional_bp():
   host=page.locator('[data-tool="disassembly"]');host.locator('[data-edit="2"]').click();host.locator('[aria-label="IL breakpoint condition"]').fill('arg0 == 20');host.locator('button[type="submit"]').click();page.wait_for_function('sharpforge.getState().debug.breakpoints.length===1');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.reason?.reason==="instruction breakpoint"');truth(page.evaluate('sharpforge.getState().debug.frames[0].ilOffset')==2);truth(page.evaluate('sharpforge.evaluate("arg0 + arg1")')['result']=='42')
  checked('conditional instruction breakpoint stops before add; safe watch sees args',conditional_bp)
  def step():
   page.evaluate('sharpforge.step("stepIn")');page.wait_for_function('sharpforge.getState().debug.frames[0]?.ilOffset===3');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42')
  checked('single instruction step then continue returns actual method result',step)
  def restart():
   page.evaluate('sharpforge.execute("restart")');page.wait_for_function('sharpforge.getState().debug?.state==="paused" && sharpforge.getState().debug.reason?.reason==="entry"');truth(page.evaluate('sharpforge.getState().debug.breakpoints.length')==1);truth(page.evaluate('sharpforge.evaluate("arg0")')['result']=='20')
  checked('restart retains uploaded DLL, arguments and instruction breakpoints',restart)
  def run_to():
   page.locator('[data-tool="disassembly"] [data-clear]').click();page.wait_for_function('sharpforge.getState().debug.breakpoints.length===0');page.locator('[data-tool="disassembly"] [data-run-to="3"]').click();page.wait_for_function('sharpforge.getState().debug.reason?.reason==="goto"');truth(page.evaluate('sharpforge.getState().debug.frames[0].ilOffset')==3)
  checked('run-to-instruction uses a temporary stop',run_to)
  def layout():
   page.evaluate('sharpforge.floatPanel("disassembly")');truth(page.locator('.sf-dock-floating [data-tool="disassembly"]').is_visible());page.evaluate('sharpforge.dockPanel("disassembly","tools-bottom","center")');truth(page.locator('[data-tool="disassembly"]').is_visible());page.wait_for_function('document.querySelectorAll("#toasts .toast").length===0');page.screenshot(path=str(RESULTS/'screenshots/release05-il-debugger.png'),full_page=True)
  checked('new debugger tool floats and redocks without losing session',layout)
  def primitive():
   page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/PrimitiveAddresses.exe'));page.locator('[data-il-action="invoke"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.returnValue==="52"')
  checked('hand-authored EXE executes unbox address, cpobj, sizeof and GC',primitive)
  def project():
   page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/PropertiesAndCleanup'));page.wait_for_function('sharpforge.getState().startupProject?.endsWith("PropertiesAndCleanup.csproj") && sharpforge.getState().artifact!==null');page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="cleanup\\n42\\n"')
  checked('disk SLNX and csproj execute properties with finally cleanup',project)
  checked('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
  result={'passed':True,'browser':browser.version,'mode':'in-memory-production-workers' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'CSP HTTP and real workers','checks':checks,'errors':errors}
 except Exception as error:
  traceback.print_exc();result={'passed':False,'checks':checks,'errors':errors,'failure':str(error)};page.screenshot(path=str(RESULTS/'screenshots/release05-failure.png'),full_page=True)
 finally:
  (RESULTS/'browser-release05-results.json').write_text(json.dumps(result,indent=2)+'\n')
 if not result['passed']:raise SystemExit(1)
