"""0.6 acceptance using built production modules and both real workers.
Normal HTTP can be used with SHARPFORGE_BROWSER_URL; no navigation-policy bypass.
"""
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
 page=browser.new_page(viewport={'width':1600,'height':1080});page.on('pageerror',lambda e:errors.append(e.stack or str(e)));workers=[];page.on('worker',lambda w:workers.append(w.url));mode='http' if os.getenv('SHARPFORGE_IN_MEMORY') != '1' else 'in-memory-production-workers'
 try:
  load_application(page)
  checked('two production compiler/runtime workers initialized',lambda:truth(len(workers)==2))
  manifest=json.loads((ROOT/'examples/features-0.6/manifest.json').read_text())
  def example(sample):
   page.evaluate('(id)=>sharpforge.loadSample(id,true)',sample['id']);page.wait_for_function('sharpforge.getState().artifact!==null');page.evaluate('sharpforge.run()');page.wait_for_function('(expected)=>sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output===expected',arg=sample['expectedOutput'])
  for sample in manifest:checked('production workers: '+sample['id'],lambda sample=sample:example(sample))
  page.evaluate('sharpforge.execute("stop");sharpforge.openFile("Program.cs")');area=page.locator('[data-source-uri="Program.cs"] .sf-input')
  def viewport():
   text=''.join('Console.WriteLine('+str(i)+'); // viewport '+str(i)+'\n' for i in range(12000));page.locator('#file-input').set_input_files({'name':'Program.cs','mimeType':'text/plain','buffer':text.encode()});page.wait_for_function('(text)=>sharpforge.getEditorState("Program.cs")?.value===text',arg=text)
   metrics=page.evaluate('sharpforge.getEditorState("Program.cs").highlight');truth(metrics['paintedCharacters']<5000,str(metrics));truth(metrics['totalTokens']>70000,str(metrics))
   area.evaluate('(e)=>{e.scrollTop=6000*22;e.dispatchEvent(new Event("scroll"));}');page.wait_for_function('sharpforge.getEditorState("Program.cs").highlight.firstLine>5900');view=page.locator('[data-source-uri="Program.cs"] .sf-highlight');truth('viewport 6000' in view.inner_text());truth(len(view.inner_text())<5000);truth(view.locator('span').count()<1000)
  checked('large editor scroll renders only visible syntax and gutter',viewport)
  def paste():
   text=''.join('int value'+str(i)+'='+str(i)+';\n' for i in range(300));version=page.evaluate('sharpforge.getState().files.find(f=>f.uri==="Program.cs").version');area.fill(text);truth(page.evaluate('sharpforge.getState().files.find(f=>f.uri==="Program.cs").version')==version+1,'duplicate native input events must publish only one source revision');truth(area.input_value()==text)
  checked('native multiline replacement publishes one revision despite duplicate events',paste)
  def selection():
   area.fill('//😀\nint answer=(1+2)*3;\nConsole.WriteLine(answer);');at=area.input_value().index('2');# Python offset counts scalar values; source contains one surrogate pair.
   at+=1;area.evaluate('(e,at)=>{e.setSelectionRange(at,at);e.dispatchEvent(new Event("select"));}',at);area.press('Control+Alt+ArrowRight');page.wait_for_function('sharpforge.getEditorState("Program.cs").end>sharpforge.getEditorState("Program.cs").start');first=page.evaluate('sharpforge.getEditorState("Program.cs")');area.press('Control+Alt+ArrowRight');page.wait_for_function('(n)=>sharpforge.getEditorState("Program.cs").end-sharpforge.getEditorState("Program.cs").start>n',arg=first['end']-first['start']);area.press('Control+Alt+ArrowLeft');truth(page.evaluate('sharpforge.getEditorState("Program.cs").start')==first['start']);truth(page.evaluate('sharpforge.getEditorState("Program.cs").end')==first['end'])
  checked('syntax expand/shrink selection uses worker UTF-16 ranges',selection)
  def navigation():
   page.evaluate('sharpforge.loadSample("partial",true)');page.evaluate('sharpforge.openFile("Program.cs",12,15);sharpforge.openFile("Calculator.cs",25,28);sharpforge.openFile("Calculator.State.cs",18,21)');page.locator('#navigate-back').click();truth(page.evaluate('sharpforge.getState().active')=='Calculator.cs');truth(page.evaluate('sharpforge.getEditorState("Calculator.cs").start')==25);page.keyboard.press('Alt+ArrowLeft');truth(page.evaluate('sharpforge.getState().active')=='Program.cs');page.locator('#navigate-forward').click();truth(page.evaluate('sharpforge.getState().active')=='Calculator.cs')
  checked('document Back/Forward restores selection and crosses source files',navigation)
  def refactor():
   page.evaluate('sharpforge.loadSample("refactor-safe06",true);sharpforge.openFile("Program.cs")');area=page.locator('[data-source-uri="Program.cs"] .sf-input');area.evaluate('(e)=>{const at=e.value.indexOf("int amount")+4;e.setSelectionRange(at,at);}');area.press('Control+.');page.wait_for_selector('[data-refactor]');page.locator('[data-refactor]').filter(has_text="Make 'amount' constant").click();page.wait_for_function('sharpforge.getEditorState("Program.cs").value.includes("const int amount")');truth(page.evaluate('sharpforge.build()')['success']);area.press('Control+z');truth('const int amount' not in area.input_value())
  checked('make-constant action applies validated edit and one-step undo',refactor)
  def project():
   page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/CheckedResources'));page.wait_for_function('sharpforge.getState().startupProject?.endsWith("App/App.csproj") && sharpforge.getState().artifact!==null');page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="checked project\\n-2147483648\\ndisposed\\n"')
  checked('disk SLNX preserves per-project checked defaults and using cleanup',project)
  def open_storage():
   page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/StorageWrites.exe'));page.wait_for_selector('#assembly-history');truth(page.locator('#assembly-history').is_checked());page.locator('[data-il-action="debug"]').click();page.wait_for_function('sharpforge.getState().debug?.profile==="managed-il" && sharpforge.getState().debug?.state==="paused"');page.wait_for_selector('[data-tool="disassembly"] [data-instruction]');truth(page.evaluate('sharpforge.getState().debug.history.enabled') is True)
  checked('ordinary hand-authored EXE opens with optional reversible history',open_storage)
  def locals_watch():
   page.evaluate('sharpforge.openTool("debug")');row=page.locator('[data-tool="debug"] [data-local]').filter(has_text='V_1');truth(row.count()==1);row.click(button='right');page.locator('#menu-popup button').filter(has_text='Break on write').click();page.wait_for_function('sharpforge.getState().debug.dataBreakpoints?.length===1');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug.reason?.reason==="data breakpoint"');truth(page.evaluate('sharpforge.evaluate("local1")')['result']=='40');truth(page.locator('[data-write-breakpoint]').count()==1)
  checked('local context menu creates write breakpoint and stops after storage changes',locals_watch)
  def reverse_local():
   host=page.locator('[data-tool="disassembly"]');host.locator('[data-reverse-step]').click();page.wait_for_function('sharpforge.getState().debug.reason?.reason==="step"');truth(page.evaluate('sharpforge.evaluate("local1")')['result']=='0');page.evaluate('sharpforge.step("stepIn")');page.wait_for_function('sharpforge.getState().debug.reason?.reason==="data breakpoint"');truth(page.evaluate('sharpforge.evaluate("local1")')['result']=='40')
  checked('step back restores local and instruction, then write breakpoint replays',reverse_local)
  def array_watch():
   page.locator('[data-clear-write]').click();page.wait_for_function('sharpforge.getState().debug.dataBreakpoints.length===0');page.evaluate('sharpforge.openTool("debug")');page.locator('[data-tool="debug"] [data-local]').filter(has_text='V_0').click();page.wait_for_selector('[data-tool="object"] [data-child]');page.locator('[data-tool="object"] [data-child="0"]').click(button='right');page.locator('#menu-popup button').filter(has_text='Break on write').click();page.wait_for_function('sharpforge.getState().debug.dataBreakpoints?.[0]?.kind==="array"');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug.reason?.reason==="data breakpoint"');truth(page.evaluate('sharpforge.evaluate("local0[0]")')['result']=='40')
  checked('object inspector array child watches generation-checked element storage',array_watch)
  def array_reverse():
   page.locator('[data-reverse-step]').click();page.wait_for_function('sharpforge.getState().debug.reason?.reason==="step"');truth(page.evaluate('sharpforge.evaluate("local0[0]")')['result']=='0');page.evaluate('sharpforge.step("stepIn")');page.wait_for_function('sharpforge.getState().debug.reason?.reason==="data breakpoint"');truth(page.evaluate('sharpforge.evaluate("local0[0]")')['result']=='40')
  checked('reverse restores array heap contents and replay restores write',array_reverse)
  def finish_reverse():
   page.locator('[data-clear-write]').click();page.wait_for_function('sharpforge.getState().debug.dataBreakpoints.length===0');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42');page.evaluate('sharpforge.openTool("disassembly")');page.locator('[data-reverse-step]').click();page.wait_for_function('sharpforge.getState().debug?.state==="paused"');truth(page.evaluate('sharpforge.getState().debug.history.count')>0);page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42')
  checked('completed ordinary EXE reverses and resumes without recompilation',finish_reverse)
  def reverse_continue():
   page.evaluate('sharpforge.openTool("disassembly")')
   for _ in range(8):
    previous=page.evaluate('sharpforge.getState().debug.stats.instructions')
    if previous==0:break
    page.locator('[data-reverse-continue]').click();page.wait_for_function('(n)=>sharpforge.getState().debug?.state==="paused" && sharpforge.getState().debug.stats.instructions<n',arg=previous,timeout=10000)
   truth(page.evaluate('sharpforge.getState().debug.stats.instructions')==0);truth(page.evaluate('sharpforge.getState().debug.history.count')==0)
  checked('reverse continue visits recorded write stops then earliest retained instruction',reverse_continue)
  def history_off():
   page.evaluate('sharpforge.openTool("assembly")');page.locator('#assembly-history').uncheck();page.locator('[data-il-action="debug"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="paused" && !sharpforge.getState().debug.history.enabled');page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"');truth(page.evaluate('sharpforge.getState().debug.history.count')==0);truth(page.evaluate('sharpforge.getState().debug.returnValue')=='42')
  checked('history toggle disables snapshot work while preserving invocation',history_off)
  def severities():
   page.evaluate('sharpforge.loadSample("unreachable-analyzer",true);sharpforge.openTool("extensions")');page.locator('[data-tool="extensions"] summary').click();page.locator('[data-severity="SFAN1005"]').select_option('none');page.locator('#extension-apply').click();page.wait_for_function('!sharpforge.getState().diagnostics.some(d=>d.code==="SFAN1005")');truth(page.evaluate('sharpforge.build()')['success'])
  checked('analyzer severity settings round-trip through docked tool and worker',severities)
  def screenshot():
   page.evaluate('sharpforge.loadSample("using-resources",true);sharpforge.execute("debugLayout")');page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/StorageWrites.exe'));page.locator('#assembly-history').check();page.locator('[data-il-action="debug"]').click();page.wait_for_function('sharpforge.getState().debug?.state==="paused"');page.evaluate('sharpforge.step("stepIn")');page.wait_for_function('sharpforge.getState().debug.stats.instructions===1');page.evaluate('sharpforge.step("stepIn")');page.wait_for_function('sharpforge.getState().debug.stats.instructions===2');page.evaluate('sharpforge.openTool("watch")');page.locator('[data-remove-watch]').first.click();page.locator('#watch-expression').fill('V_1');page.locator('#add-watch').click();page.evaluate('sharpforge.openTool("disassembly")');page.wait_for_selector('[data-reverse-step]:not([disabled])');page.wait_for_function('document.querySelectorAll("#toasts .toast").length===0');page.screenshot(path=str(RESULTS/'screenshots/release06-reversible-il.png'),full_page=True)
  checked('updated docking workspace renders source, IL and reverse controls',screenshot)
  checked('active docking captions remain visible after debug preset and activation',lambda:truth(page.evaluate("""()=>[...document.querySelectorAll('.sf-dock-tabs')].every(tabs=>{const active=tabs.querySelector('[aria-selected="true"]');if(!active||!tabs.clientWidth)return true;const a=active.getBoundingClientRect(),b=tabs.getBoundingClientRect();return a.right>b.left&&a.left<b.right;})""")))
  checked('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
  result={'passed':True,'browser':browser.version,'mode':mode,'checks':checks,'errors':errors}
 except Exception as error:
  traceback.print_exc();result={'passed':False,'checks':checks,'errors':errors,'failure':str(error)};page.screenshot(path=str(RESULTS/'screenshots/release06-failure.png'),full_page=True,timeout=5000)
 finally:
  (RESULTS/'browser-release06-results.json').write_text(json.dumps(result,indent=2)+'\n')
 if not result['passed']:raise SystemExit(1)
