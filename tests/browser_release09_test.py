"""Debugger acceptance using production Studio, compiler and runtime workers (no debugger mocks)."""
import json,os,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import load_in_memory
ROOT=Path(__file__).resolve().parents[1]
checks=[]
def truth(value,message='assertion failed'):
 if not value:raise AssertionError(message)
def check(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.getenv('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1728,'height':1050},device_scale_factor=1);page.set_default_timeout(15000)
 errors=[];workers=[];page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('worker',lambda w:workers.append(w.url))
 def state():return page.evaluate('sharpforge.getState()')
 def wait(expr):page.wait_for_function(expr,timeout=15000)
 def cmd(name):return page.evaluate('(name)=>sharpforge.execute(name)',name)
 def ev(expr):return page.evaluate(expr)
 def paused():wait('sharpforge.getState().debug?.state==="paused"');return state()['debug']
 def finished():wait('sharpforge.getState().debug?.state==="terminated"');return state()['debug']
 def debug(options=None):page.evaluate('(options)=>sharpforge.debug(options)',options or {});return paused()
 def sample(name):cmd('stop');page.evaluate('(name)=>sharpforge.loadSample(name,true)',name);wait('sharpforge.getState().artifact!==null');ev('sharpforge.setFunctionBreakpoints([]);sharpforge.configureDebug({stopOnEntry:false,breakpointsEnabled:true,recordHistory:true,exceptionBreak:"uncaught",exceptionRules:[]})');cmd('resetLayout')
 def load(text):
  cmd('stop');ev('sharpforge.setKeymap("visual-studio")');page.evaluate('(records)=>sharpforge.loadDiskRecords(records)',[{'path':'Debugger.csproj','text':'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>'},{'path':'Program.cs','text':text}]);wait('sharpforge.getState().artifact!==null');ev('sharpforge.setFunctionBreakpoints([]);sharpforge.configureDebug({stopOnEntry:false,breakpointsEnabled:true,exceptionBreak:"uncaught",exceptionRules:[]});sharpforge.openFile("Program.cs")');truth(not state()['diagnostics'],str(state()['diagnostics']))
 def bps(items):return page.evaluate('(items)=>sharpforge.setBreakpoints("Program.cs",items)',items)
 def value(name):return page.evaluate('(name)=>sharpforge.evaluate(name)',name)['result']
 def editor():return ev('sharpforge.getEditorState("Program.cs")')
 try:
  if os.getenv('SHARPFORGE_BROWSER_URL'):page.goto(os.environ['SHARPFORGE_BROWSER_URL']);wait('window.sharpforge?.getState().metrics!==null')
  else:load_in_memory(page)
  check('two real workers and default F5 run-to-breakpoint policy',lambda:truth(len(workers)==2 and ev('sharpforge.getDebugSettings().stopOnEntry') is False))
  def exact_screenshot():
   sample('recursion');bps([{'line':20}]);page.locator('#start').click();d=paused();truth(d['reason']['reason']=='breakpoint',str(d['reason']));truth(d['point']['line']==20 and d['frames'][0]['line']==20);truth(d['output']=='');truth(d['breakpoints'][0]['hits']==1);truth(editor()['executionLine']==20);truth(editor()['selectedFrameLine'] is None);truth(page.locator('#debug-stop-banner').get_attribute('data-phase')=='before');truth(page.locator('[data-source-uri="Program.cs"] .sf-line.breakpoint.execution[data-line="20"]').count()==1);truth('Console.WriteLine' in ''.join(page.locator('.sf-current-statement').all_text_contents()))
  check('screenshot reproduction: F5 stops at line 20 before output; frame, gutter, span and count agree',exact_screenshot)
  def all_fib():
   for i in range(1,10):
    page.locator('#start').click();wait('sharpforge.getState().debug?.state==="paused" && sharpforge.getState().debug.breakpoints[0].hits==='+str(i+1));d=paused();truth(d['point']['line']==20 and d['breakpoints'][0]['hits']==i+1,str(d));truth(value('i')==str(i));truth(len(d['output'].splitlines())==i)
   page.locator('#start').click();d=finished();truth(d['output'].endswith('fib(9) = 34\n'));truth(editor()['executionLine'] is None)
  check('all ten Fibonacci hits have correct values and encounter counts; termination clears markers',all_fib)
  def entry():
   sample('recursion');bps([{'line':20}]);page.keyboard.press('F11');d=paused();truth(d['reason']['reason']=='entry');truth(d['point']['line']==16);truth(d['breakpoints'][0]['hits']==0);truth('entry stop (explicitly requested)' in page.locator('#debug-stop-banner').inner_text().lower())
  check('F11 from idle explicitly stops at line 16 and explains it is not a breakpoint',entry)
  def f10_entry():
   cmd('stop');page.keyboard.press('F10');truth(paused()['reason']['reason']=='entry');truth(editor()['executionLine']==16)
  check('F10 from idle also requests entry without changing default F5 setting',f10_entry)
  def configured_entry():
   cmd('stop');cmd('debugSettings');page.locator('[data-setting="stopOnEntry"]').check();d=debug();truth(d['reason']['reason']=='entry');cmd('stop');cmd('debugSettings');page.locator('[data-setting="stopOnEntry"]').uncheck();truth(ev('sharpforge.getDebugSettings().stopOnEntry') is False)
  check('explicit F5 entry preference can be changed through docked debugger settings',configured_entry)
  def multiline():
   load('int x=42;\nConsole.WriteLine(\n x\n);\nConsole.WriteLine(7);');bps([{'line':3}]);d=debug();truth(d['point']['line']==2 and d['point']['endLine']==4);truth(d['breakpoints'][0]['requestedLine']==3 and d['breakpoints'][0]['line']==2);truth(d['output']=='');ev('sharpforge.openTool("breakpoints")');truth('requested 3' in page.locator('[data-bp-kind="source"]').inner_text());truth('containing' in page.locator('[data-bp-kind="source"]').inner_text())
  check('continuation-line breakpoint binds the containing multiline statement, not the next one',multiline)
  def relocated_toggle():
   page.locator('[data-source-uri="Program.cs"] .sf-line.breakpoint[data-line="2"]').click();wait('sharpforge.getState().debug.breakpoints.length===0');truth(ev('sharpforge.getBreakpoints()["Program.cs"].length')==0)
  check('clicking a relocated gutter marker removes its requested anchor',relocated_toggle)
  def close_brace():
   load('class P {\nstatic void A(){\nConsole.WriteLine(1);\n}\nstatic void Main(){\nConsole.WriteLine(2);\n}\n}');bps([{'line':4}]);ev('sharpforge.debug()');d=finished();truth(d['breakpoints'][0]['verified'] is False);truth(d['output']=='2\n');ev('sharpforge.openTool("breakpoints")');truth('Unbound' in page.locator('[data-bp-kind="source"]').inner_text())
  check('non-executable closing brace stays unbound instead of jumping into another method',close_brace)
  def columns():
   text='int x=1; x=2; Console.WriteLine(x);';load(text);bps([{'line':1,'column':text.index('x=2')+1}]);d=debug();truth(d['point']['column']==10);truth(value('x')=='1');truth(''.join(page.locator('.sf-current-statement').all_text_contents())=='x=2;')
  check('column breakpoint selects one same-line statement and paints only its exact span',columns)
  def caller():
   load('class P {\nstatic int F(int n){\n return n+1;\n}\nstatic void Main(){\n int a=41;\n int b=F(a);\n Console.WriteLine(b);\n}\n}');bps([{'line':3}]);d=debug();truth(d['frames'][0]['line']==3 and d['frames'][1]['line']==7);page.evaluate('(id)=>sharpforge.selectDebugFrame(id)',d['frames'][1]['id']);truth(editor()['executionLine']==3);truth(editor()['selectedFrameLine']==7);truth(value('a')=='41');truth('Inspecting caller' in page.locator('#debug-stop-banner').inner_text());truth(page.locator('.sf-line.selected-frame[data-line="7"]').count()==1)
  check('selecting a caller retains the true executing marker and shows the suspended callsite separately',caller)
  def immediate_caller():
   cmd('immediate');page.locator('#immediate-expression').fill('a+1');page.locator('#immediate-form button').click();wait('document.querySelector(".debug-immediate-log").textContent.includes("42")');truth('41'==value('a'));page.locator('#immediate-expression').press('ArrowUp');truth(page.locator('#immediate-expression').input_value()=='a+1')
  check('Immediate evaluates in selected caller frame and supports command history',immediate_caller)
  def unsafe_immediate():
   r=ev('sharpforge.immediate("a=5")');truth(bool(r.get('error')),str(r));truth(value('a')=='41');r=ev('sharpforge.immediate("P.F(a)")');truth(bool(r.get('error')),str(r));truth(value('a')=='41')
  check('Immediate rejects assignments and method calls without mutating program state',unsafe_immediate)
  def next_statement():
   page.locator('#debug-stop-banner [data-next]').click();truth(editor()['selectedFrameLine'] is None);truth(value('n')=='41');truth(editor()['executionLine']==3)
  check('Show Next Statement returns selection and inspection to the executing frame',next_statement)
  def source_write():
   load('class P {\nstatic int F(){return 42;}\nstatic void Main(){\n int x=0;\n x=F();\n Console.WriteLine(x);\n}\n}');bps([{'line':5},{'line':6}]);d=debug();ev('sharpforge.openTool("debug")');page.locator('[data-tool="debug"] [data-local]').filter(has_text='x').first.click(button='right');page.locator('#menu-popup button').filter(has_text='Break on write').click();wait('sharpforge.getState().debug.dataBreakpoints.length===1');d=debug();truth(d['reason']['reason']=='data breakpoint');truth(d['point']['line']==5 and d['frames'][0]['line']==5);truth(value('x')=='42');truth(editor()['executionLine']==5);truth(page.locator('#debug-stop-banner').get_attribute('data-phase')=='after')
  check('source local write after a callee return stops on caller assignment, not callee return',source_write)
  def next_after_write():
   d=debug();truth(d['reason']['reason']=='breakpoint' and d['point']['line']==6);truth(d['output']=='')
  check('continue from post-write stop does not skip the next unvisited source breakpoint',next_after_write)
  def changed():
   load('for(int i=0;i<5;i++)\n{\n Console.WriteLine(i);\n}\n');bps([{'line':3,'condition':'i / 2','conditionMode':'whenChanged'}]);d=debug();truth(value('i')=='2');truth(d['breakpoints'][0]['hits']==3);d=debug();truth(value('i')=='4' and d['breakpoints'][0]['hits']==5)
  check('when-changed conditions seed without stopping and count all encounters',changed)
  def reverse():
   cmd('reverseContinue');d=paused();truth(value('i')=='2');truth(d['breakpoints'][0]['hits']==3);d=debug();truth(value('i')=='4' and d['breakpoints'][0]['hits']==5)
  check('reverse continue restores a recorded conditional stop and replay restores its hit count',reverse)
  def single_flight():
   cmd('stop');bps([{'line':3}]);debug();ev('Promise.all([sharpforge.debug(),sharpforge.debug(),sharpforge.debug()])');d=paused();truth(value('i')=='1' and d['breakpoints'][0]['hits']==2)
  check('rapid duplicate Continue requests are coalesced and cannot skip a breakpoint stop',single_flight)
  def dialog():
   ev('sharpforge.openTool("breakpoints")');page.locator('[data-bp-kind="source"] .file-cell').dblclick();page.locator('#bp-condition').fill('i == 4');page.locator('#bp-condition-mode').select_option('whenTrue');page.locator('#bp-once').check();page.locator('#ask-confirm').click();wait('document.querySelector("#modal-backdrop").classList.contains("hidden")');truth(ev('sharpforge.getBreakpoints()["Program.cs"][0].oneShot') is True)
  check('breakpoint dialog edits safe conditions, changed mode and one-shot flag',dialog)
  def once():
   cmd('stop');d=debug();truth(value('i')=='4');truth(d['breakpoints'][0]['enabled'] is False);truth(d['breakpoints'][0]['hits']==5);ev('sharpforge.openTool("breakpoints")');truth(not page.locator('[data-bp-enabled="0"]').is_checked());ev('sharpforge.debug()');finished()
  check('one-shot breakpoint disables after qualifying hit and is visibly unchecked',once)
  def function():
   load('class P {static int F(int n){return n;}static void Main(){Console.WriteLine(F(1));Console.WriteLine(F(2));}}');ev('sharpforge.openTool("breakpoints")');page.locator('#new-function-breakpoint').click();page.locator('#bp-function').fill('P.F(int)');page.locator('#bp-condition').fill('n == 2');page.locator('#ask-confirm').click();wait('document.querySelector("#modal-backdrop").classList.contains("hidden")');d=debug();truth(d['reason']['reason']=='function breakpoint');truth(value('n')=='2');truth(d['functionBreakpoints'][0]['hits']==2);ev('sharpforge.openTool("breakpoints")');truth(page.locator('[data-bp-kind="function"]').count()==1)
  check('function breakpoint dialog binds signature and stops only for qualifying arguments',function)
  def mute():
   page.locator('#mute-breakpoints').click();wait('sharpforge.getDebugSettings().breakpointsEnabled===false');truth(ev('sharpforge.getDebugSettings().breakpointsEnabled') is False);truth(page.locator('[data-bp-enabled="0"]').is_checked());ev('sharpforge.debug()');finished();truth(state()['debug']['functionBreakpoints'][0]['hits']==2);ev('sharpforge.configureDebug({breakpointsEnabled:true})')
  check('global mute preserves individual flags and does not reset encounter counts',mute)
  def exception_settings():
   load('try {\n int n=2147483647;\n n=checked(n+1);\n} catch(Exception e){\n Console.WriteLine(e.Message);\n}');cmd('debugSettings');page.locator('#debug-exception-default').select_option('none');page.locator('#exception-type').fill('System.OverflowException');page.locator('#exception-type-mode').select_option('all');page.locator('#exception-rule-form button').click();wait('sharpforge.getDebugSettings().exceptionRules.length===1');d=debug();truth(d['reason']['reason']=='exception');truth(d['reason']['exceptionType']=='OverflowException',str(d['reason']));truth(d['point']['line']==3)
  check('per-type Exception Settings stop at checked overflow even when global breaking is off',exception_settings)
  def exception_reverse():
   ev('sharpforge.debug()');d=finished();expected=d['output'];truth(bool(expected));cmd('reverseContinue');d=paused();truth(d['reason']['reason']=='exception');truth(d['point']['line']==3);ev('sharpforge.debug()');truth(finished()['output']==expected)
  check('reversing to a thrown-exception snapshot preserves pending fault and cleanup on replay',exception_reverse)
  def idle_cursor():
   load('int n=1;\nn=2;\nConsole.WriteLine(n);');page.locator('[data-source-uri="Program.cs"] .sf-input').evaluate('(e)=>{const i=e.value.indexOf("Console");e.setSelectionRange(i,i);}');cmd('runToCursor');d=paused();truth(d['reason']['reason']=='goto');truth(d['point']['line']==3);truth(d['breakpoints']==[]);truth(value('n')=='2')
  check('Run to Cursor from idle uses a temporary target without adding a persistent breakpoint',idle_cursor)
  def paused_cursor():
   cmd('stop');debug({'stopOnEntry':True});page.locator('[data-source-uri="Program.cs"] .sf-input').evaluate('(e)=>{const i=e.value.indexOf("Console");e.setSelectionRange(i,i);}');cmd('runToCursor');truth(paused()['point']['line']==3)
  check('Run to Cursor in a paused source session reaches the requested statement',paused_cursor)
  def crlf():
   load('// 😀 source\r\nint value=42;\r\nConsole.WriteLine(\r\n value\r\n);\r\n');bps([{'line':4}]);d=debug();truth(d['point']['line']==3 and d['point']['endLine']==5);truth('Console.WriteLine(\n value\n);'==''.join(page.locator('.sf-current-statement').all_text_contents()));truth(ev('(()=>{const e=sharpforge.getEditorState("Program.cs");return e.value.slice(e.executionPoint.start,e.executionPoint.end);})()').startswith('Console.WriteLine'))
  check('CRLF and UTF-16 source ranges map into normalized textarea spans without offset drift',crlf)
  def mode_vim():
   ev('sharpforge.setKeymap("vim")');truth(page.locator('.sf-cm-breakpoint').count()==1);truth(page.locator('.sf-cm-arrow.execution').count()==1);text=editor()['value'];page.locator('.CodeMirror').click();page.keyboard.type('iBAD');page.keyboard.press('Escape');truth(editor()['value']==text);ev('sharpforge.setKeymap("visual-studio")');truth(editor()['executionLine']==3)
  check('Vim shows breakpoint and execution markers together and keeps paused source read-only',mode_vim)
  def mismatch():
   cmd('stop');assembly=ev('Array.from(sharpforge.getAssembly())');page.locator('[data-source-uri="Program.cs"] .sf-input').fill('Console.WriteLine(999);');page.evaluate('(bytes)=>sharpforge.invokeAssembly(new Uint8Array(bytes),0x06000001,[],{debug:true})',assembly);d=paused();truth(d['profile']=='managed-il');truth(editor()['executionLine'] is None);truth('Source unavailable or different' in page.locator('#debug-stop-banner').inner_text())
  check('an assembly with different embedded source never paints a false yellow location in the editor',mismatch)
  def instruction_manager():
   ev('sharpforge.openTool("disassembly")');page.locator('[data-instruction] [data-toggle]').nth(1).click();wait('sharpforge.getState().debug.breakpoints.length===1');ev('sharpforge.openTool("breakpoints")');row=page.locator('[data-bp-kind="instruction"]');truth(row.count()==1);truth('il:' in row.inner_text());row.locator('[data-bp-enabled]').uncheck();wait('sharpforge.getState().debug.breakpoints[0].enabled===false');ev('sharpforge.openTool("disassembly")');page.locator('[data-instruction] [data-toggle]').nth(2).click();wait('sharpforge.getState().debug.breakpoints.length===2');truth(state()['debug']['breakpoints'][0]['enabled'] is False);cmd('restart');paused();truth(state()['debug']['breakpoints'][0]['enabled'] is False)
  check('unified instruction manager and disassembly retain disabled rules across edits and restart',instruction_manager)
  def tools():
   cmd('stop');cmd('resetLayout')
   for name in ['debug-session','immediate']:
    ev('sharpforge.openTool('+json.dumps(name)+')');page.locator('[data-tool="'+name+'"]').click(button='right',position={'x':50,'y':20});truth(page.locator('.sf-menu:visible').count()==1);page.keyboard.press('Escape')
  check('new debugger tools participate in shared docking context menus',tools)
  def all_count():
   ids=ev('(()=>{const l=sharpforge.getLayout(),a=[...l.closed,...Object.values(l.autoHide).flat()];function walk(n){if(n.type==="group")a.push(...n.panels);else{walk(n.first);walk(n.second);}}walk(l.root);for(const f of l.floating)walk(f.root);return [...new Set(a.filter(id=>!id.startsWith("source:")))];})()');truth(len(ids)==44,str(ids))
  check('all 44 independent workbench tools are available',all_count)
  manifest=json.loads((ROOT/'examples/features-0.9/manifest.json').read_text())
  def shipped_example(example):
   cmd('stop');page.evaluate('(id)=>sharpforge.loadSample(id,true)',example['id']);truth(ev('sharpforge.getBreakpoints()')==example['debug'].get('breakpoints',{}));ev('sharpforge.run()');truth(finished()['output']==example['expectedOutput'])
  for example in manifest:check('production workers run shipped '+example['id'],lambda example=example:shipped_example(example))
  def final_shot():
   sample('recursion');bps([{'line':20}]);debug();ev('sharpforge.openTool("breakpoints")');wait('document.querySelectorAll("#toasts .toast").length===0');page.mouse.move(880,34);page.screenshot(path=str(ROOT/'docs/screenshots/release09-breakpoint.png'),full_page=True)
  check('capture requested Fibonacci breakpoint with exact statement and stop explanation',final_shot)
  def caller_shot():
   ev('sharpforge.setFunctionBreakpoints([{name:"Program.Fibonacci(int)",condition:"n == 2"}]);sharpforge.setBreakpoints("Program.cs",[])');d=debug();truth(d['reason']['reason']=='function breakpoint');caller=d['frames'][-1];page.evaluate('(id)=>sharpforge.selectDebugFrame(id)',caller['id']);ev('sharpforge.openTool("stack")');page.screenshot(path=str(ROOT/'docs/screenshots/release09-callstack.png'),full_page=True);cmd('debugSettings');page.screenshot(path=str(ROOT/'docs/screenshots/release09-settings.png'),full_page=True)
  check('capture separate executing and inspected caller locations and debugger settings',caller_shot)
  check('no page JavaScript errors',lambda:truth(not errors,str(errors)))
  result={'passed':True,'browser':browser.version,'mode':'http' if os.getenv('SHARPFORGE_BROWSER_URL') else 'in-memory-production-workers','workers':len(workers),'checks':checks,'errors':errors}
 except Exception as e:
  traceback.print_exc();result={'passed':False,'checks':checks,'errors':errors,'failure':str(e)};print('STATE',json.dumps(state().get('debug'),ensure_ascii=False)[:14000]);page.screenshot(path=str(ROOT/'docs/screenshots/release09-failure.png'),full_page=True,timeout=5000)
 finally:
  (ROOT/'docs/browser-release09-results.json').write_text(json.dumps(result,indent=2)+'\n');browser.close()
 if not result['passed']:raise SystemExit(1)
