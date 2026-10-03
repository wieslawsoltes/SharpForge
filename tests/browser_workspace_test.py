"""0.4 production-worker acceptance: disk inputs, docking, split editors and popouts.
The in-memory mode does not bypass or test native HTTP/file-origin policy.
"""
import json, os, subprocess, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1]
checks=[];errors=[];server=None

def check(name,action):
 start=time.perf_counter();action();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
def truth(value,message='assertion failed'):
 if not value:raise AssertionError(message)
try:
 with sync_playwright() as p, launch_browser(p, __file__) as browser:
  page=browser.new_page(viewport={'width':1600,'height':1050});page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)))
  mode='in-memory' if os.getenv('SHARPFORGE_IN_MEMORY')=='1' else 'http'
  load_application(page)
  state=lambda:page.evaluate('sharpforge.getState()')
  wait=lambda expr:page.wait_for_function(expr,timeout=15000)
  cmd=lambda value:page.evaluate('(c)=>sharpforge.execute(c)',value)
  layout=lambda:page.evaluate('sharpforge.getLayout()')
  def sample(name):page.evaluate('(s)=>sharpforge.loadSample(s,true)',name)
  def dock(id,group,side='center'):page.evaluate('p=>sharpforge.dockPanel(...p)',[id,group,side])
  def editor(uri):return page.locator(f'[data-source-uri="{uri}"] .sf-input')
  def placed(node):
   return node['panels'] if node['type']=='group' else placed(node['first'])+placed(node['second'])
  def allids(l):return placed(l['root'])+sum((placed(f['root']) for f in l['floating']),[])+sum(l['autoHide'].values(),[])+l['closed']
  def panels():
   for id in ['solution','diagnostics','output','problems','debug','watch','stack','breakpoints','assembly','bytecode','heap','object','generated','extensions','references','calls','outline','search','project','examples','layouts']:
    page.evaluate('id=>sharpforge.openTool(id)',id);truth(page.locator(f'[data-dock-panel="{id}"]').count()==1,id)
   ids=allids(layout());truth(len(ids)==len(set(ids)));truth(page.locator('#legacy-tool-markers').count()==0)
   cmd('resetLayout')
  check('all 21 tools have independent dock identities; no legacy shared panels',panels)
  def split_buffers():
   sample('partial');dock('source:Calculator.cs','documents','right')
   truth(editor('Program.cs').is_visible());truth(editor('Calculator.cs').is_visible())
   before=editor('Calculator.cs').input_value();editor('Calculator.cs').fill(before+'// preserved edit\n');editor('Calculator.cs').press('Control+End');editor('Calculator.cs').press('x');editor('Calculator.cs').press('Control+z')
   truth(editor('Calculator.cs').input_value()==before+'// preserved edit\n');truth(state()['active']=='Calculator.cs')
   page.evaluate('sharpforge.openFile("Program.cs")');truth(editor('Calculator.cs').input_value().endswith('// preserved edit\n'))
   result=page.evaluate('sharpforge.build()');truth(result['success'],str(result['diagnostics']))
  check('split documents keep independent buffers, focus, undo and compiler contents',split_buffers)
  def split_refactor():
   files=state()['files'];a=next(f for f in files if f['uri']=='Program.cs');b=next(f for f in files if f['uri']=='Calculator.cs')
   edits=[]
   for f in [a,b]:
    pos=0
    while (pos:=f['text'].find('Add',pos))>=0:
     edits.append({'uri':f['uri'],'start':pos,'end':pos+3,'newText':'Sum','version':f['version']});pos+=3
   result=page.evaluate('edits=>sharpforge.applyRefactoring({title:"Rename method",edits})',edits)
   truth('Sum' in editor('Program.cs').input_value());truth('Sum' in editor('Calculator.cs').input_value());truth(not any(d['severity']=='error' for d in state()['diagnostics']))
  check('multi-file validated edits update both visible split editors',split_refactor)
  def keyboard_editor():
   sample('arrays');box=editor('Program.cs');box.fill('int a=1;\nint b=2;\nConsole.WriteLine(a+b);');box.evaluate('(e)=>e.setSelectionRange(0,0)');box.press('Control+/');truth(box.input_value().startswith('//'));box.press('Control+/');truth(box.input_value().startswith('int a'))
   box.press('Alt+ArrowDown');truth(box.input_value().startswith('int b=2;\nint a=1;'));box.press('Control+z');truth(box.input_value().startswith('int a=1;'))
   before=box.input_value();box.dispatch_event('compositionstart');box.dispatch_event('keydown',{'key':'/','ctrlKey':True,'isComposing':True});box.dispatch_event('compositionend');truth(box.input_value()==before)
  check('toggle comments, move line, undo and IME shortcut guard',keyboard_editor)
  def float_panel():
   page.evaluate('sharpforge.floatPanel("output")');floating=page.locator('.sf-dock-floating');truth(floating.count()==1);before=floating.bounding_box();title=floating.locator('.sf-dock-float-title').first;box=title.bounding_box();page.mouse.move(box['x']+70,box['y']+12);page.mouse.down();page.mouse.move(box['x']+145,box['y']+50,steps=5);page.mouse.up();after=floating.bounding_box();truth(after['x']>before['x']+40)
   grip=floating.locator('.sf-dock-float-grip').bounding_box();page.mouse.move(grip['x']+3,grip['y']+3);page.mouse.down();page.mouse.move(grip['x']+63,grip['y']+33,steps=4);page.mouse.up();truth(floating.bounding_box()['width']>after['width']+30)
   dock('output','tools-bottom');truth(not layout()['floating'])
  check('floating tools move, resize and redock using live contents',float_panel)
  def splitter_keyboard():
   cmd('resetLayout');divider=page.locator('[data-split-id=split-left] > .sf-dock-divider');old=layout()['root']['ratio'];divider.focus();divider.press('ArrowRight');truth(layout()['root']['ratio']>old);truth(page.evaluate('document.activeElement.classList.contains("sf-dock-divider")'))
  check('splitter keyboard sizing preserves focus',splitter_keyboard)
  def autohide():
   page.evaluate('sharpforge.autoHidePanel("diagnostics","right")');shelf=page.locator('.sf-dock-shelf.right button');shelf.click();truth(page.locator('.sf-dock-auto-popup [data-tool=diagnostics]').is_visible());page.keyboard.press('Escape');truth(page.locator('.sf-dock-auto-popup').count()==0);shelf.click();page.locator('.sf-dock-auto-popup [aria-label="Pin tool window"]').click();truth('diagnostics' not in layout()['autoHide']['right']);truth(page.locator('[data-tool=diagnostics]').is_visible());cmd('resetLayout')
  check('auto-hide shelf opens live tools, Escape closes, pin restores',autohide)
  def drag_dock():
   source=page.locator('[data-dock-tab=output]');target=page.locator('[data-dock-group=tools-right]');source.drag_to(target,target_position={'x':20,'y':150});truth('output' not in layout()['closed']);truth(page.locator('.sf-dock-compass').count()==0);truth(page.locator('[data-dock-tab=output]').count()==1)
   # A left-edge drop creates a new split/group, rather than merely selecting a tab.
   truth(page.locator('.sf-dock-group').count()>=5);cmd('resetLayout')
  check('HTML drag/drop creates an edge split and clears docking guide',drag_dock)
  def named_layout():
   cmd('windowLayouts');page.locator('#layout-name').fill('Acceptance layout');page.locator('#layout-save').click();saved=layout();page.evaluate('sharpforge.floatPanel("output")');page.locator('[data-layout]').filter(has_text='Acceptance layout').focus();page.locator('[data-layout]').filter(has_text='Acceptance layout').press('Enter');truth(layout()==saved)
   before=layout();error=page.evaluate('()=>{const l=sharpforge.getLayout();l.closed.push("unknown");try{sharpforge.restoreLayout(l);return null;}catch(e){return e.message;}}');truth(error);truth(layout()==before)
  check('named layout restores placements and invalid imports roll back',named_layout)
  def separate_tool():
   cmd('tool:output')
   with page.expect_popup() as opened:page.evaluate('sharpforge.popoutPanel("output")')
   popup=opened.value;popup.on('pageerror',lambda e:errors.append(str(e)));truth(popup.locator('[data-tool=output]').is_visible());page.evaluate('sharpforge.run()');wait('sharpforge.getState().debug?.state==="terminated"');truth('3' in popup.locator('[data-tool=output]').inner_text());popup.get_by_text('Return to main workspace',exact=True).click();truth(popup.is_closed());truth(page.locator('[data-tool=output]').is_visible())
  check('separate browser tool window receives real worker output and returns intact',separate_tool)
  def separate_doc():
   page.evaluate('sharpforge.openFile("Program.cs")');before=editor('Program.cs').input_value()
   with page.expect_popup() as opened:page.evaluate('sharpforge.popoutPanel("source:Program.cs")')
   popup=opened.value;popup.on('pageerror',lambda e:errors.append(str(e)));box=popup.locator('.sf-input');box.fill(before+'\n// detached edit');truth(state()['files'][0]['text'].endswith('// detached edit'));box.press('Control+Shift+b');wait('sharpforge.getState().diagnostics.every(d=>d.severity!=="error")');popup.close();editor('Program.cs').wait_for(state='visible');truth(editor('Program.cs').is_visible());truth(editor('Program.cs').input_value().endswith('// detached edit'))
  check('separate document window edits and compiles through shared workspace; close reattaches',separate_doc)
  def open_directory():
   page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/Workshop'));wait('sharpforge.getState().project?.projects.length===2');wait('sharpforge.getState().metrics?.errors===0');truth(state()['startupProject'].endswith('App/App.csproj'));truth(len(state()['files'])==3);page.evaluate('sharpforge.run()');wait('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="42\\n"')
  check('native directory file input loads SLNX, inherited props and project references',open_directory)
  def project_guard():
   before=state()['files'];error=page.evaluate('async()=>{try{await sharpforge.loadDiskRecords([{path:"Bad.csproj",text:"<!DOCTYPE Project><Project/>"}]);return null;}catch(e){return e.message;}}');truth(error);truth(state()['files']==before)
  check('malformed disk project does not replace active source workspace',project_guard)
  def unsupported_project():
   page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/Unsupported'));wait('sharpforge.getState().diagnostics.some(d=>d.code==="SFP1102")');result=page.evaluate('sharpforge.build()');truth(not result['success']);truth(state()['artifact'] is None)
  check('unresolved package diagnostic blocks source/IL build instead of being ignored',unsupported_project)
  def library_project():
   page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/Library'));wait('sharpforge.getState().artifact!==null && sharpforge.getState().startupProject?.endsWith("Library.csproj")');page.evaluate('sharpforge.run()');wait('document.querySelector(".assembly-toolbar b")?.textContent.includes("Library")');page.locator("[data-il-method]").filter(has=page.locator("b",has_text="Add")).click();page.locator("#assembly-arguments").fill("[1,1]");page.locator("[data-il-action=invoke]").click();wait('sharpforge.getState().debug?.returnValue==="42"');truth(not any(d['severity']=='error' for d in state()['diagnostics']));truth('Library' in page.locator('[data-tool=project]').inner_text())
  check('library csproj builds without Main and Run opens method invocation workbench',library_project)
  def dll_file():
   before=state()['files'];page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/Arithmetic.dll'));wait('document.querySelector(".assembly-toolbar b")?.textContent.includes("Arithmetic")');truth(state()['files']==before);page.locator('#assembly-arguments').fill('[20,23]');page.locator('[data-il-action=invoke]').click();wait('sharpforge.getState().debug?.returnValue==="43"')
  check('direct decompiler DLL file picker preserves project and invokes selected method',dll_file)
  def exe_file():
   before=state()['files'];page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/Hello.exe'));wait('document.querySelector(".assembly-toolbar b")?.textContent.includes("Hello")');truth(state()['files']==before);truth(page.locator('.assembly-chooser option').count()>=2);page.locator('[data-il-action=all]').click();wait('document.querySelector("#assembly-code")?.value.includes("Hello from an ordinary managed EXE")');page.locator('[data-il-action=invoke]').click();wait('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="Hello from an ordinary managed EXE\\n"')
  check('direct decompiler EXE file picker shows full IL, executes entry point and retains history',exe_file)
  def find_replace():
   sample('call-hierarchy');cmd('findFiles');page.locator('#workspace-search').fill('Twice');wait('document.querySelector("#workspace-search-results")?.textContent.includes("Program.cs")');page.locator('#workspace-replace').fill('Double');page.locator('#replace-preview').click();page.wait_for_selector('#apply-search-replace');page.locator('#apply-search-replace').click();wait('sharpforge.getState().files[0].text.includes("Double(21)")');truth('Twice' not in state()['files'][0]['text'])
  check('find in files and replace-all preview apply a validated source transaction',find_replace)
  def call_hierarchy():
   page.evaluate('sharpforge.openFile("Program.cs")');box=editor('Program.cs');box.evaluate('(e)=>{const i=e.value.indexOf("Double");e.setSelectionRange(i,i);}');box.press('Shift+Alt+h');wait('document.querySelector("[data-tool=calls]")?.textContent.includes("Calls to this method")');truth('Main' in page.locator('[data-tool=calls]').inner_text());truth('Add' in page.locator('[data-tool=calls]').inner_text())
  check('call hierarchy tool shows bound incoming and outgoing source calls',call_hierarchy)
  def source_cases():
   for id,out in [('partial','Add\n42\n'),('switch','one\nsmall\nsmall\nother\n'),('conversions','3\n1.5\n0\nFalse\n-2147483648\n'),('null-assignment','local\nfield\narray\n'),('guarded-calls','invalid input\n42\n'),('short-circuit','False\nTrue\n0\nyes\n'),('nameof','unassigned\nValue\n')]:
    sample(id);page.evaluate('sharpforge.run()');wait('sharpforge.getState().debug?.state==="terminated"');truth(state()['debug']['output']==out,id+': '+state()['debug']['output'])
  check('seven additional C# feature examples execute in real browser workers',source_cases)
  def heap_pages():
   sample('gc');page.evaluate('sharpforge.debug({stopOnEntry:true})');wait('sharpforge.getState().debug?.state==="paused"');cmd('heap');truth(page.locator('#heap-kind').is_visible());truth(page.locator('#heap-next').is_disabled());truth('Type census' in page.locator('[data-tool=heap]').inner_text());cmd('stop')
  check('managed heap paging and census controls run against worker heap',heap_pages)
  def responsive():
   sample('partial');cmd('resetLayout');page.wait_for_function('document.querySelectorAll(".toast").length===0',timeout=12000);page.screenshot(path=str(RESULTS/'screenshots/docking-workspace.png'));cmd('theme');page.screenshot(path=str(RESULTS/'screenshots/docking-workspace-light.png'));cmd('theme');dock('source:Calculator.cs','documents','right');page.screenshot(path=str(RESULTS/'screenshots/docking-split-editors.png'));cmd('resetLayout');page.set_viewport_size({'width':390,'height':844});truth(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));cmd('toggleExplorer');truth(page.locator('#solution').is_visible());cmd('toggleExplorer');truth(editor('Program.cs').is_visible());page.screenshot(path=str(RESULTS/'screenshots/docking-workspace-mobile.png'))
  check('desktop dark/light and 390px responsive docking layouts',responsive)
  check('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
except Exception as error:
 checks.append({'name':'acceptance failure','passed':False,'error':str(error)});traceback.print_exc()
finally:
 if server:server.terminate()
 report={'version':'0.4.0','mode':os.getenv('SHARPFORGE_IN_MEMORY')=='1' and 'in-memory production modules and workers' or 'http','nativeWritePermissions':'not tested; permission and conflict logic covered by node mocks','checks':checks,'passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'errors':errors}
 (RESULTS/'browser-workspace-results.json').write_text(json.dumps(report,indent=2)+'\n')
 if report['failed']:raise SystemExit(1)
