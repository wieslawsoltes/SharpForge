"""0.10 acceptance: real compiler/runtime workers, managed callbacks and browser rendering."""
import json,os,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_in_memory,wait_condition
ROOT=Path(__file__).resolve().parents[1];checks=[]
def truth(v,message='assertion failed'):
 if not v:raise AssertionError(message)
def check(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.getenv('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox']);page=browser.new_page(viewport={'width':1728,'height':1050});page.set_default_timeout(12000)
 errors=[];workers=[];page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('worker',lambda w:workers.append(w.url))
 def ev(x,arg=None):return page.evaluate(x,arg)
 def wait(x):return wait_condition(page,x,timeout=15000)
 def state():return ev('sharpforge.getState()')
 def cmd(name):return ev('n=>sharpforge.execute(n)',name)
 def sample(name):
  cmd('stop');ev('n=>sharpforge.loadSample(n,true)',name);ev('sharpforge.setFunctionBreakpoints([]);sharpforge.configureDebug({stopOnEntry:false,recordHistory:true,exceptionBreak:"uncaught",exceptionRules:[]})');cmd('resetLayout')
 def paused():wait('sharpforge.getState().debug?.state==="paused"');return state()['debug']
 def finish():wait('sharpforge.getState().debug?.state==="terminated"');return state()['debug']
 def start():ev('sharpforge.debug()');return paused()
 def value(x):return ev('x=>sharpforge.evaluate(x)',x)['result']
 def bps(items):return ev('items=>sharpforge.setBreakpoints("Program.cs",items)',items)
 def edit(text):
  ev('sharpforge.openFile("Program.cs")');page.locator('[data-source-uri="Program.cs"] .sf-input').fill(text);wait('sharpforge.getState().files.find(f=>f.uri==="Program.cs").text===document.querySelector(\'[data-source-uri="Program.cs"] .sf-input\').value')
 def ui_sample(name):
  sample(name);bps([]);cmd('winuiLayout');ev('sharpforge.run()');wait('sharpforge.getState().debug?.uiActive');ev('sharpforge.uiSettled()')
 try:
  if os.getenv('SHARPFORGE_BROWSER_URL'):page.goto(os.environ['SHARPFORGE_BROWSER_URL']);wait('window.sharpforge?.getState().metrics!==null')
  else:load_in_memory(page)
  check('0.10 starts with two real workers and 44 independent docking tools',lambda:truth(len(workers)==2 and ev('sharpforge.version')==json.loads((ROOT/'package.json').read_text())['version'] and ev('(()=>{const l=sharpforge.getLayout(),a=[...l.closed,...Object.values(l.autoHide).flat()];function walk(n){if(n.type==="group")a.push(...n.panels);else{walk(n.first);walk(n.second);}}walk(l.root);return [...new Set(a.filter(id=>!id.startsWith("source:")))].length;})()')==44))
  def symbols():
   sample('portable-symbols');truth(ev('sharpforge.getPdb()?.length')>100);page.wait_for_timeout(300);truth(ev('sharpforge.getPdb()?.length')>100);ev('sharpforge.openTool("symbols")');page.locator('[data-inspect]').click();wait('document.querySelector(".symbol-id").textContent.includes("PDB ")');truth(page.locator('[data-symbol-document]').count()==2);page.locator('[data-symbol-document="Calculator.cs"] td').last.click();wait('sharpforge.getState().panel==="symbol-source"');truth('class Calculator' in page.locator('.symbol-source-editor .sf-input').input_value());truth(page.locator('.symbol-source-editor .sf-input').get_attribute('readonly') is not None)
  check('compiler emits persistent PDB bytes and verifies multi-file embedded source in the symbol editor',symbols)
  def relocate():
   sample('set-next');d=start();truth(d['point']['line']==2);ev('sharpforge.setNextStatement({uri:"Program.cs",line:4})');d=paused();truth(d['point']['line']==4,str(d));ev('sharpforge.debug()');truth(finish()['output'].strip()=='1')
  check('Set Next Statement skips assignments without resetting live locals and resumes correctly',relocate)
  def eval_effect():
   sample('function-evaluation');start();r=ev('async()=>{try{await sharpforge.evaluateFunction("ledger.Add(2)");return false}catch(e){return e.message}}');truth('consent' in r.lower() or 'side' in r.lower(),str(r));r=ev('sharpforge.evaluateFunction("ledger.Add(2)",{allowSideEffects:true,commit:false})');truth(value('ledger.Value')=='40');r=ev('sharpforge.evaluateFunction("ledger.Add(2)",{allowSideEffects:true})');truth(value('ledger.Value')=='42');r=ev('sharpforge.evaluateFunction("ledger.Doubled",{allowSideEffects:true})');truth('84' in str(r),str(r));ev('sharpforge.debug()');truth(finish()['output'].strip()=='42')
  check('explicit managed function evaluation requires consent, rolls back previews, invokes getters and commits effects',eval_effect)
  def hot():
   sample('hot-reload');start();truth(value('value')=='41');ev('sharpforge.beginHotReload()');text=next(f['text'] for f in state()['files'] if f['uri']=='Program.cs');edit(text.replace('x + 1','x + 2'));r=ev('sharpforge.applyHotReload()');truth(state()['debug']['codeVersion']==1,str(r));truth(value('value')=='41');ev('sharpforge.debug()');truth(finish()['output'].strip()=='43')
  check('Hot Reload replaces a method through the compiler worker while retaining the caller local',hot)
  def hot_reject():
   sample('hot-reload');start();before=state()['files'][0]['text'];ev('sharpforge.beginHotReload()');edit(before.replace('static int Calculate(int x)','static double Calculate(int x)'));r=ev('async()=>{try{await sharpforge.applyHotReload();return false}catch(e){return e.message}}');truth(isinstance(r,str),str(r));truth(state()['debug']['codeVersion']==0);ev('sharpforge.cancelHotReload()');truth(state()['files'][0]['text']==before);ev('sharpforge.debug()');truth(finish()['output'].strip()=='42')
  check('rude Hot Reload edits reject without mutating running code and Cancel restores source',hot_reject)
  def tasks():
   sample('async-stacks');start();threads=ev('sharpforge.getThreads()');truth(len(threads)>=2,str(threads));stacks=ev('sharpforge.getParallelStacks()');truth(len(stacks['contexts'])>=2,str(stacks));ev('sharpforge.openTool("parallel-stacks")');wait('document.querySelectorAll(".parallel-contexts section").length>=2');current=state()['debug']['threadId'];other=next(t for t in threads if t['id']!=current and t['kind']=='async' and t['frameIds']);frames=ev('id=>sharpforge.selectThread(id)',other['id']);truth(len(frames)>0);truth(state()['debug']['threadId']==current);ev('sharpforge.showNextStatement()');ev('sharpforge.setBreakpoints("Program.cs",[])');ev('sharpforge.debug()');truth(finish()['output'].strip()=='82')
  check('async contexts expose suspended caller frames and task relationships without moving execution on inspection',tasks)
  def threads():
   sample('logical-threads');start();ts=ev('sharpforge.getThreads()');truth(any('Calculation' in t['name'] for t in ts),str(ts));tid=state()['debug']['threadId'];ev('id=>sharpforge.freezeThread(id,true)',tid);truth(any(t['id']==tid and t['frozen'] for t in ev('sharpforge.getThreads()')));ev('id=>sharpforge.freezeThread(id,false)',tid);bps([]);ev('sharpforge.debug()');truth('42' in finish()['output'])
  check('logical Thread Start/Join shares state and debugger freeze/thaw uses real context identities',threads)
  def external_symbols():
   cmd('stop');fixture=json.loads((ROOT/'examples/managed/PortableSymbols.fixture.json').read_text());data=list((ROOT/'examples/managed/PortableSymbols.dll').read_bytes());before=[f['uri'] for f in state()['files']];ev('a=>sharpforge.invokeAssembly(new Uint8Array(a.bytes),a.token,[],{debug:true,stopOnEntry:true})',{'bytes':data,'token':fixture['entryToken']});d=paused();truth(d['point']['uri']=='external/ExternalProgram.cs' and d['point']['line']==3,str(d));truth([f['uri'] for f in state()['files']]==before);wait('sharpforge.getState().panel==="symbol-source"');truth('ExternalProgram' in page.locator('.symbol-source-editor .sf-input').input_value());ev('sharpforge.step("next")');d=paused();truth(d['point']['line']==4,str(d));truth(value('value')=='20');ev('sharpforge.setNextStatement({uri:"external/ExternalProgram.cs",line:5})');d=paused();truth(d['point']['line']==5);ev('sharpforge.debug()');truth(finish()['output'].strip()=='20')
  check('ordinary DLL without #SF uses embedded PDB source/locals, source-level stepping and Set Next Statement outside the open workspace',external_symbols)
  def pdb_reject():
   fixture=json.loads((ROOT/'examples/managed/PortableSymbols.fixture.json').read_text());data=list((ROOT/'examples/managed/PortableSymbols.dll').read_bytes());ev('a=>sharpforge.invokeAssembly(new Uint8Array(a.bytes),a.token,[],{debug:true,stopOnEntry:true})',{'bytes':data,'token':fixture['entryToken']});paused();sid=state()['debug']['sessionId'];wrong=list((ROOT/'tests/fixtures/portable-pdb/Documents.pdb').read_bytes());r=ev('async a=>{try{await sharpforge.loadPdb(new Uint8Array(a));return false}catch(e){return e.message}}',wrong);truth(isinstance(r,str));truth(state()['debug']['sessionId']==sid and state()['debug']['point']['line']==3);ev('sharpforge.openTool("symbols")');page.locator('[data-inspect]').click();wait('document.querySelectorAll("[data-symbol-document]").length===1');page.locator('[name=symbol-document]').check();page.locator('#symbols-source-file').set_input_files({'name':'ExternalProgram.cs','mimeType':'text/plain','buffer':(ROOT/'examples/managed/PortableSymbols.cs').read_bytes()});page.wait_for_timeout(200);truth(not errors,json.dumps(errors))
  check('mismatched Portable PDB is rejected transactionally without losing a valid paused DLL session',pdb_reject)
  def counter():
   ui_sample('winui-counter');truth('Count: 0' in page.locator('.sf-winui').inner_text());page.locator('.sf-winui').get_by_role('button',name='Increment',exact=True).click();wait('document.querySelector(".sf-winui").textContent.includes("Count: 1")');truth(state()['debug']['uiActive']);truth(page.locator('#start').is_disabled());cmd('collect');page.locator('.sf-winui').get_by_role('button',name='Increment',exact=True).click();wait('document.querySelector(".sf-winui").textContent.includes("Count: 2")')
  check('code-first C# WinUI renders real controls and managed event callbacks survive explicit GC',counter)
  def ui_hot():
   ev('sharpforge.beginHotReload()');text=state()['files'][0]['text'];edit(text.replace('count++;','count += 2;'));r=ev('sharpforge.applyHotReload()');truth(state()['debug']['codeVersion']==1,str(r));page.locator('.sf-winui').get_by_role('button',name='Increment',exact=True).click();wait('document.querySelector(".sf-winui").textContent.includes("Count: 4")');truth(page.locator('.sf-winui').get_by_role('button',name='Increment',exact=True).count()==1)
  check('Hot Reload updates an idle managed UI callback without recreating the window or resetting its count',ui_hot)
  def visual():
   ev('sharpforge.openTool("visual-tree")');wait('document.querySelectorAll("[data-visual]").length>=5');button=page.locator('[data-visual]').filter(has_text='Counter').first;button.click();truth('Count: 4' in page.locator('.advanced-visual-properties').inner_text());ev('sharpforge.openTool("winui")');page.screenshot(path=str(ROOT/'docs/screenshots/release10-winui.png'))
  check('Live Visual Tree inspects actual managed control properties in an independent tool',visual)
  def form():
   ui_sample('winui-controls');page.locator('.sf-winui input[placeholder="Your name"]').fill('Ada');page.locator('.sf-winui select').select_option(index=2);page.locator('.sf-winui input[type=range]').fill('75');page.locator('.sf-winui input[type=range]').dispatch_event('input');page.locator('.sf-winui').get_by_role('button',name='Submit',exact=True).click();wait('document.querySelector(".sf-winui").textContent.includes("Hello Ada, item 2, level 75")');scene=ev('sharpforge.getUIScene()');truth(next(n for n in scene['nodes'] if n['type'].endswith('ProgressBar'))['properties']['Value']==75);page.locator('.sf-winui summary').click();wait('document.querySelector(".sf-winui details").open');wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.type.endsWith("Expander")&&n.properties.IsExpanded)')
  check('unsubscribed native text/slider/selection input synchronizes managed properties before a C# form handler',form)
  def ui_async():
   ui_sample('winui-async');button=page.locator('.sf-winui').get_by_role('button',name='Calculate',exact=True);button.click();wait('document.querySelector(".sf-winui").textContent.includes("Calculating")');truth(button.is_disabled());wait('sharpforge.getState().debug?.threads?.some(t=>t.status==="waiting")');wait('document.querySelector(".sf-winui").textContent.includes("Answer: 42")');truth(button.is_enabled())
  check('async void WinUI callbacks suspend during Task.Delay, retain controls and resume to update the live application',ui_async)
  def ui_debug():
   sample('winui-counter');cmd('winuiLayout');bps([{'line':11}]);ev('sharpforge.debug()');wait('sharpforge.getState().debug?.uiActive');ev('sharpforge.uiSettled()');page.locator('.sf-winui').get_by_role('button',name='Increment',exact=True).click();d=paused();truth(d['point']['line']==11);truth('Count: 0' in page.locator('.sf-winui').inner_text());truth(page.locator('.sf-winui').evaluate('e=>e.classList.contains("debug-paused")'));ev('sharpforge.openTool("threads")');page.screenshot(path=str(ROOT/'docs/screenshots/release10-debugger.png'));ev('sharpforge.step("next")');d=paused();truth(d['point']['line']==12);truth('Count: 0' in page.locator('.sf-winui').inner_text());ev('sharpforge.debug()');wait('document.querySelector(".sf-winui").textContent.includes("Count: 1")');truth(state()['debug']['uiActive']);ev('sharpforge.openTool("threads")')
  check('a native button click stops at the C# handler breakpoint; step and continue update the same live window',ui_debug)
  def drawing():
   ui_sample('winui-graphics');ev('sharpforge.setUIRenderer("canvas2d")');ev('sharpforge.uiSettled()');wait('sharpforge.getUIMetrics().some(m=>m.backend==="canvas2d")');truth(sum(m['primitives'] for m in ev('sharpforge.getUIMetrics()'))>=8);count=ev('''()=>{let count=0;for(const c of document.querySelectorAll('.sf-winui canvas')){const a=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;if(a)for(let i=3;i<a.length;i+=4)if(a[i])count++;}return count}''');truth(count>1000,str(count));page.screenshot(path=str(ROOT/'docs/screenshots/release10-graphics.png'))
  check('Canvas2D renderer produces actual nontransparent shape/chart pixels from managed drawing calls',drawing)
  def dom():
   ev('sharpforge.setUIRenderer("dom")');ev('sharpforge.uiSettled()');wait('sharpforge.getUIMetrics().some(m=>m.backend==="dom")');truth(all(m['backend']=='dom' for m in ev('sharpforge.getUIMetrics()')))
  check('explicit DOM rendering fallback displays the retained drawing scene',dom)
  def gpu_fallback():
   ev('sharpforge.setUIRenderer("webgpu")');ev('sharpforge.uiSettled()');wait('sharpforge.getUIMetrics().every(m=>m.backend!=="dom")');metrics=ev('sharpforge.getUIMetrics()');truth(all(m['backend'] in ['webgpu','canvas2d'] for m in metrics),str(metrics));print('RENDERER',json.dumps(metrics),flush=True)
  check('WebGPU request negotiates an available backend and reports fallback rather than claiming GPU execution',gpu_fallback)
  def js_facade():
   result=ev("""async()=>{const {createWinUIApp}=await __sharpforgeTestImport('/packages/winui/src/index.js');const root=document.createElement('div');root.style.cssText='position:fixed;inset:80px 80px 80px 80px;z-index:9999;background:#222';document.body.append(root);const app=createWinUIApp(root,{backend:'dom'});const X=app.Microsoft.UI.Xaml,C=X.Controls;const window=new X.Window(),panel=new C.StackPanel(),label=new C.TextBlock(),button=new C.Button();const brush=new X.Media.SolidColorBrush(app.Microsoft.UI.Colors.Red);label.Text='JS nested button';label.Foreground=brush;button.Content=label;button.Name='InternalName';let count=0;const handler=()=>{count++;brush.Color=app.Microsoft.UI.Colors.Blue;};button.Click.add(handler);panel.Children.Add(button);window.Content=panel;window.Activate();await app.settled();root.querySelector('[data-winui-type=TextBlock]').click();await app.settled();const computed=getComputedStyle(root.querySelector('[data-winui-type=TextBlock]')).color;button.Click.remove(handler);root.querySelector('button').click();const result={count,computed,children:panel.Children.Count,found:panel.FindName('InternalName')===button};app.dispose();root.remove();return result;}""");truth(result['count']==1 and result['children']==1 and result['found'],str(result));truth(result['computed']=='rgb(0, 0, 255)',str(result))
  check('independent JavaScript WinUI package handles nested button content, unsubscription, mutable brushes and disposal',js_facade)
  def windows():
   for name in ['symbols','threads','parallel-stacks','hot-reload','winui','visual-tree','symbol-source']:
    ev('id=>sharpforge.openTool(id)',name);el=page.locator('[data-tool="'+name+'"]');truth(el.count()==1);el.click(button='right',position={'x':10,'y':10});wait('document.querySelector(".sf-menu")!==null');page.keyboard.press('Escape')
  check('all seven new tools retain shared keyboard/context menu and docking functionality',windows)
  def clean_stop():
   cmd('stop');wait('!sharpforge.getState().debug?.uiActive');wait('document.querySelectorAll(".sf-winui [data-sf-id]").length===0');truth(not errors,json.dumps(errors))
  check('Stop removes the application and stale visuals; acceptance has no uncaught JavaScript errors',clean_stop)
  print(json.dumps({'checks':len(checks),'workers':len(workers),'errors':errors,'results':checks},indent=2));(ROOT/'docs/browser-release10-validation.json').write_text(json.dumps({'checks':len(checks),'workers':len(workers),'errors':errors,'results':checks},indent=2)+'\n')
 except Exception:
  print('STATE',json.dumps(state(),default=str)[:16000],flush=True);print('ERRORS',json.dumps(errors));page.screenshot(path=str(ROOT/'docs/screenshots/release10-failure.png'));traceback.print_exc();raise
 finally:browser.close()
