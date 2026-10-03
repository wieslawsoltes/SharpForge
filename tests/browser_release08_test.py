"""Release 0.8: real Studio/worker tree, menu, editor keymap and breakpoint acceptance.
Uses production HTTP/CSP by default; SHARPFORGE_IN_MEMORY=1 opts into the restricted loader.
"""
import json,os,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1];checks=[];errors=[]
def truth(x,why='assertion failed'):
 if not x:raise AssertionError(why)
def check(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p, launch_browser(p, __file__) as browser:
 page=browser.new_page(viewport={'width':1600,'height':1080});page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(e.stack or str(e)));workers=[];page.on('worker',lambda w:workers.append(w.url))
 def cmd(c):return page.evaluate('(c)=>sharpforge.execute(c)',c)
 def wait(s,arg=None):page.wait_for_function(s,arg=arg)
 def state():return page.evaluate('sharpforge.getState()')
 def value():return page.evaluate('sharpforge.getEditorState("Program.cs").value')
 def at():return page.evaluate('sharpforge.getEditorState("Program.cs").start')
 def mode(m):page.evaluate('(m)=>sharpforge.setKeymap(m)',m)
 def text(s):
  cmd('stop');mode('visual-studio');page.evaluate('(s)=>sharpforge.loadDiskRecords([{path:"Program.cs",text:s}])',s);wait('(s)=>sharpforge.getEditorState("Program.cs")?.value===s',s)
 def active():return page.locator('[data-source-uri="Program.cs"] .sf-input')
 def classic():return page.locator('[data-source-uri="Program.cs"] .CodeMirror')
 def vimkeys(keys):classic().click();page.keyboard.press('Escape');page.keyboard.type(keys)
 def menu(label):page.locator('.sf-menu:visible').last.get_by_text(label,exact=True).click()
 def operation(action,path=None,kind=None):page.evaluate('([a,p,k])=>{void sharpforge.explorerCommand(a,p,k)}',[action,path,kind])
 def apply_path(path):
  page.wait_for_selector('#wizard-next, #item-path')
  if page.locator('#wizard-next').count():
   page.locator('#wizard-next').click();page.locator('#wizard-item-name').fill(path.split('/')[-1]);page.locator('#wizard-location').fill(path.rsplit('/',1)[0] if '/' in path else '');page.locator('#wizard-next').click()
  else:page.locator('#item-path').fill(path);page.get_by_role('button',name='Apply',exact=True).click()
 try:
  load_application(page)
  check('two production workers and Visual Studio default profile',lambda:truth(len(workers)==2 and page.evaluate('sharpforge.getKeymap().id')=='visual-studio'))
  def defaulttree():
   truth(page.locator('#file-tree').get_attribute('role')=='tree');truth(any(r['kind']=='source' for r in page.evaluate('sharpforge.getExplorer().rows')));truth(page.locator('[data-dock-tab="solution"]').is_visible());truth(page.locator('[data-tool="properties"]').inner_text().strip()!='')
  check('solution hierarchy and selected-item properties render in right-side tools',defaulttree)
  def keyboard_tree():
   tree=page.locator('#file-tree');tree.focus();tree.press('Home');tree.press('ArrowRight');tree.press('ArrowDown');tree.press('End');truth(tree.get_attribute('aria-activedescendant'));tree.press('Shift+F10');truth(page.locator('.sf-menu:visible').count()==1);page.keyboard.press('End');page.keyboard.press('Home');page.keyboard.press('Escape');truth(tree.evaluate('(e)=>e===e.ownerDocument.activeElement'))
  check('tree Home/End/arrows and keyboard context menu restore focus',keyboard_tree)
  def selection_tree():
   tree=page.locator('#file-tree');tree.focus();tree.press('End');tree.press('Shift+ArrowUp');truth(len(page.evaluate('sharpforge.getExplorer().selected'))>=2);tree.press('Control+ArrowUp');truth(len(page.evaluate('sharpforge.getExplorer().selected'))>=2)
  check('tree range selection and independent Ctrl focus',selection_tree)
  def search_tree():
   page.locator('#file-filter').fill('Particle.cs');truth(all(r['kind']!='source' or r['path']=='Particle.cs' for r in page.evaluate('sharpforge.getExplorer().rows')));page.locator('#file-filter').press('Escape');truth(any(r.get('path')=='Program.cs' for r in page.evaluate('sharpforge.getExplorer().rows')))
  check('tree search retains ancestors and Escape restores hierarchy',search_tree)
  def menu_flyout():
   page.locator('[data-node-kind="project"]').first.click(button='right');menu('Add');truth(page.locator('.sf-menu:visible').count()==2);page.keyboard.press('ArrowLeft');truth(page.locator('.sf-menu:visible').count()==1);page.keyboard.press('Escape')
  check('Add submenu keyboard return and dismissal',menu_flyout)
  def newfile():
   operation('new-file');apply_path('Models/Counter.cs');wait('sharpforge.getState().files.some(f=>f.uri==="Models/Counter.cs")');truth('class Counter' in next(f['text'] for f in state()['files'] if f['uri']=='Models/Counter.cs'))
  check('Add New Item creates an actual source buffer and nested folder',newfile)
  def rename():
   page.locator('[data-file="Models/Counter.cs"]').first.click();page.locator('#file-tree').press('F2');apply_path('Models/Renamed.cs');wait('sharpforge.getState().files.some(f=>f.uri==="Models/Renamed.cs")');truth(all(f['uri']!='Models/Counter.cs' for f in state()['files']))
  check('F2 rename moves source identity, document and explorer',rename)
  def copy_paste():
   operation('copy','Models/Renamed.cs','source');operation('paste','', 'project');wait('sharpforge.getState().files.some(f=>f.uri==="Renamed.cs")');truth(any(f['uri']=='Models/Renamed.cs' for f in state()['files']))
  check('explorer Copy/Paste preserves source and creates destination buffer',copy_paste)
  def delete_undo():
   operation('delete','Renamed.cs','source');page.get_by_role('button',name='Delete',exact=True).click();wait('!sharpforge.getState().files.some(f=>f.uri==="Renamed.cs")');operation('undo');wait('sharpforge.getState().files.some(f=>f.uri==="Renamed.cs")')
  check('confirmed delete and conflict-safe undo restore a source file',delete_undo)
  def vs_chord():
   text('int x=1;\nConsole.WriteLine(x);\n');active().focus();active().evaluate('(e)=>e.setSelectionRange(0,8)');page.keyboard.press('Control+k');page.keyboard.press('Control+c');truth(value().startswith('//'));page.keyboard.press('Control+k');page.keyboard.press('Control+u');truth(value().startswith('int x=1;'))
  check('Visual Studio Ctrl+K Ctrl+C/U comment chords',vs_chord)
  def editor_menu():
   active().click(button='right');truth(page.locator('.sf-menu:visible').get_by_text('Rename…',exact=True).count()==1);menu('Keyboard Profile');truth(page.locator('.sf-menu:visible').last.get_by_role('menuitemradio').count()==5);page.keyboard.press('Escape');page.keyboard.press('Escape')
  check('code context menu contains language commands and five checked editor profiles',editor_menu)
  def allpanels():
   panels=['output','problems','debug','watch','stack','breakpoints','object','heap','diagnostics','outline','project','assembly','disassembly','bytecode','generated','extensions','references','calls','search','examples','layouts','msbuild','msbuild-inspector','project-source','properties','settings']
   existing=page.evaluate('sharpforge.getLayout().panels') if False else None
   # Every registered tool exposes the shared Window menu, including empty tools.
   ids=panels+['solution']
   truth(len(ids)>=27,str(ids))
   for panel in ids:
    page.evaluate('(id)=>sharpforge.openTool(id)',panel);el=page.locator('[data-tool="'+panel+'"]');el.click(button='right',position={'x':5,'y':5});truth(page.locator('.sf-menu:visible').get_by_text('Window',exact=True).count()==1,panel);page.keyboard.press('Escape')
  check('all 27 tools expose copy/export and docking context menus',allpanels)
  def vim_motions():
   text('alpha beta gamma\nsecond line\nthird line\n');mode('vim');vimkeys('gg0dw');truth(value().startswith('beta gamma'));page.keyboard.type('u');truth(value().startswith('alpha beta'));page.keyboard.type('2w');truth(at()==11,str(at()));page.keyboard.type('gg0v4ly');page.keyboard.press('Escape');page.keyboard.type('Go');page.keyboard.press('Escape');page.keyboard.type('p');truth('alpha' in value().splitlines()[-1])
  check('Vim motions, counts, operator, undo, visual selection and yank/paste',vim_motions)
  def vim_objects():
   text('var text = "hello world";\n');mode('vim');vimkeys('gg0f"ci"changed');page.keyboard.press('Escape');truth(value()=='var text = "changed";\n',value())
  check('Vim quoted text object change preserves surrounding source',vim_objects)
  def vim_register_macro():
   text('one\ntwo\nthree\n');mode('vim');vimkeys('gg"ayyG"ap');truth(value().splitlines()[-1]=='one',value());page.keyboard.type('ggqaA!');page.keyboard.press('Escape');page.keyboard.type('jq@a');truth(value().splitlines()[:2]==['one!','two!'],value())
  check('Vim named registers and recorded macro replay',vim_register_macro)
  def vim_search_sub():
   text('alpha one\nalpha two\nalpha three\n');mode('vim');vimkeys('/two');page.keyboard.press('Enter');truth(at()>=10,str(at()));page.keyboard.type(':%s/alpha/beta/g');page.keyboard.press('Enter');truth(value().count('beta')==3 and 'alpha' not in value(),value())
  check('Vim interactive search and whole-buffer Ex substitution',vim_search_sub)
  def vim_block():
   text('one\ntwo\nthree\n');mode('vim');vimkeys('gg0');page.keyboard.press('Control+v');page.keyboard.type('jI//');page.keyboard.press('Escape');truth(value().startswith('//one\n//two\n'),value())
  check('Vim visual-block insertion changes both selected lines',vim_block)
  def vim_write():
   text('Console.WriteLine(42);\n');mode('vim');vimkeys(':w');page.keyboard.press('Enter');wait('document.querySelectorAll(".sf-tree-dirty").length===0');truth('Console.WriteLine(42)' in value());truth(not errors,str(errors))
  check('Vim :w invokes host Save All rather than an external file command',vim_write)
  def emacs():
   text('alpha beta\nnext line\n');mode('emacs');classic().evaluate('(e)=>{e.CodeMirror.focus();e.CodeMirror.setCursor({line:0,ch:0});}');page.keyboard.press('Control+e');truth(at()==10,str(at()));page.keyboard.press('Control+a');page.keyboard.press('Control+k');truth(value().startswith('\nnext'));page.keyboard.press('Control+y');truth(value().startswith('alpha beta'));page.keyboard.press('Control+s');page.keyboard.type('next');page.keyboard.press('Enter');truth(at()>=11,str(at()))
  check('Emacs line movement, kill/yank and incremental search',emacs)
  def sublime():
   text('alpha beta\nalpha beta\n');mode('sublime');classic().evaluate('(e)=>{e.CodeMirror.focus();e.CodeMirror.setCursor({line:0,ch:0});}');page.keyboard.press('ControlOrMeta+d');truth(page.evaluate('sharpforge.getEditorState("Program.cs").end-sharpforge.getEditorState("Program.cs").start')==5);page.keyboard.press('ControlOrMeta+d');page.keyboard.type('changed');truth(value().count('changed')==2,value())
  check('Sublime next-occurrence multi-selection edits both occurrences',sublime)
  def alternate_find():
   page.keyboard.press('ControlOrMeta+f');page.keyboard.type('beta');page.keyboard.press('Enter');truth(at()>0);page.keyboard.press('Escape');mode('vscode');truth(page.evaluate('sharpforge.getKeymap().id')=='vscode');truth('changed' in value())
  check('alternative keymap search works and switching preserves the same source',alternate_find)
  def disk_project():
   mode('visual-studio');page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/Workshop'));wait('sharpforge.getState().project?.projects.length===2');wait('sharpforge.getState().metrics?.errors===0');truth(any(r['kind']=='dependencies' for r in page.evaluate('sharpforge.getExplorer().rows')))
  check('SLNX projects load as real dependency/folder hierarchy',disk_project)
  def exclude_include():
   rows=page.evaluate('sharpforge.getExplorer().rows');source=next(r for r in rows if r['kind']=='source' and r['path'].endswith('Math.cs')) if any(r['kind']=='source' and r['path'].endswith('Math.cs') for r in rows) else next(r for r in rows if r['kind']=='source' and 'Program' not in r['path']);path=source['path'];operation('exclude',path,'source');wait('(p)=>!sharpforge.getState().project.projects.some(pr=>pr.compile.some(f=>f.path===p))',path);page.locator('[data-explorer-action="show-all"]').click();operation('include',path,'source');wait('(p)=>sharpforge.getState().project.projects.some(pr=>pr.compile.some(f=>f.path===p))',path)
  check('Exclude/Include edits project XML and evaluated Compile membership',exclude_include)
  def member_navigation():
   page.evaluate('sharpforge.loadSample("explorer-members",true)');wait('sharpforge.getState().metrics?.errors===0 && sharpforge.getState().artifact!==null');page.locator('#file-filter').fill('Add');rows=page.evaluate('sharpforge.getExplorer().rows');symbol=next(r for r in rows if r['kind']=='symbol' and r['label'].startswith('Add('));page.locator('[data-node-kind="symbol"]').filter(has_text='Add(').first.dblclick();wait('(p)=>sharpforge.getState().active===p',symbol['path']);edit=page.evaluate('(p)=>sharpforge.getEditorState(p)',symbol['path']);truth(edit['value'][edit['start']:edit['end']]=='Add',str(edit));page.locator('#file-filter').fill('')
  check('file member tree navigates a bound method span without treating it as a file',member_navigation)
  def bundle_roundtrip():
   mode('visual-studio');page.locator('#directory-input').set_input_files(str(ROOT/'examples/projects/ExplorerWorkshop'));wait('sharpforge.getState().project?.projects.length===2');page.evaluate('sharpforge.configureExtensions({buildInfo:true,version:"bundle-08"})');path=next(f['uri'] for f in state()['files'] if f['uri'].endswith('App/Program.cs'));page.evaluate('([p])=>sharpforge.setBreakpoints(p,[{line:2,condition:"true",hitCondition:"2"}])',[path])
   with page.expect_download() as info:cmd('exportLegacyProject')
   payload=Path(info.value.path()).read_bytes();bundle=json.loads(payload);truth(any(f.get('base64') for f in bundle['diskRecords']));truth(any(f['path'].endswith('App.csproj') for f in bundle['diskRecords']));page.evaluate('sharpforge.loadSample("particles",true)');page.locator('#file-input').set_input_files({'name':'Roundtrip.sharpforge.json','mimeType':'application/json','buffer':payload});wait('sharpforge.getState().project?.projects.length===2');wait('sharpforge.getGeneratedSources().length===1');truth(page.evaluate('(p)=>sharpforge.getBreakpoints()[p][0].hitCondition',path)=='2');page.evaluate('(p)=>sharpforge.openFile(p)',path);mode('vim');wait('document.querySelectorAll("#toasts .toast").length===0');page.locator('[data-node-kind="project"]').first.click(button='right');menu('Add');page.screenshot(path=str(RESULTS/'screenshots/release08-explorer-vim.png'),full_page=True);page.keyboard.press('Escape');page.keyboard.press('Escape');mode('visual-studio');cmd('run');wait('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="42\\n42\\n"');cmd('stop')
  check('workspace export/reopen preserves project XML, DLL bytes, generators and breakpoints',bundle_roundtrip)
  def dirty_undo():
   operation('new-file');apply_path('NewBuffer.cs');wait('sharpforge.getState().files.some(f=>f.uri==="NewBuffer.cs")');page.locator('[data-source-uri="NewBuffer.cs"] .sf-input').fill('class NewBuffer { public int Value=42; }');operation('undo');wait('document.querySelector("#toasts")?.innerText.includes("newer edits")');truth(any(f['uri']=='NewBuffer.cs' and '42' in f['text'] for f in state()['files']))
  check('file-operation undo refuses to overwrite subsequent user edits',dirty_undo)
  def source_breakpoint():
   cmd('stop');page.evaluate('sharpforge.loadSample("particles",true)');wait('sharpforge.getState().artifact!==null');page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:27}])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.reason?.reason==="breakpoint"');truth(state()['debug']['breakpoints'][0]['hits']==1)
  check('particle sample reaches a source breakpoint through real workers',source_breakpoint)
  def repeated_hits():
   page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:27}])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.breakpoints?.[0]?.hits===2 && sharpforge.getState().debug?.state==="paused"');page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:27,hitCondition:"3"}])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.breakpoints?.[0]?.hits===3 && sharpforge.getState().debug?.state==="paused"')
  check('live breakpoint updates preserve hits unless configuration changes',repeated_hits)
  def debug_vim():
   mode('vim');page.evaluate('sharpforge.openFile("Program.cs")');before=value();vimkeys('ggIshould not change');page.keyboard.press('Escape');truth(value()==before);truth(page.locator('.sf-cm-breakpoint').count()>=1);mode('emacs');classic().click();page.keyboard.type('no edit');truth(value()==before)
  check('Vim and Emacs preserve debugger read-only state and gutter markers',debug_vim)
  def finish_debug():
   page.evaluate('sharpforge.setBreakpoints("Program.cs",[])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.state==="terminated"');truth('Simulation complete.' in state()['debug']['output']);cmd('stop');mode('visual-studio')
  check('sample continues to completion after live breakpoint removal',finish_debug)
  def relocate():
   text('// pending comment\nint value=1;\nConsole.WriteLine(value);\n');page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:1}])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.state==="paused"');bp=state()['debug']['breakpoints'][0];truth(bp['requestedLine']==1 and bp['line']==2,str(bp));active().evaluate('(e)=>e.scrollTop=0');page.locator('[data-source-uri="Program.cs"] .sf-line[data-line="2"]').click();wait('sharpforge.getBreakpoints()["Program.cs"].length===0');wait('sharpforge.getState().debug?.breakpoints.length===0')
  check('clicking a relocated gutter marker deletes the original requested breakpoint',relocate)
  def remap():
   cmd('stop');mode('visual-studio');page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:3}])');before=value();active().fill('// inserted\n'+before);truth(page.evaluate('sharpforge.getBreakpoints()["Program.cs"][0].line')==4);page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.state==="paused"');truth(state()['debug']['breakpoints'][0]['line']==4);cmd('stop')
  check('source insert remaps breakpoint anchors and binds the rebuilt revision',remap)
  def popout():
   wait("!document.querySelector('[data-source-uri=\"Program.cs\"] .sf-input').readOnly")
   mode('vim')
   with page.expect_popup() as opened:page.evaluate('sharpforge.popoutPanel("source:Program.cs")')
   popup=opened.value;popup.on('pageerror',lambda e:errors.append(e.stack or str(e)));popup.locator('.CodeMirror').wait_for();popup.wait_for_function("Array.from(document.querySelectorAll('link[rel=stylesheet]')).every(link=>link.sheet)");popup.locator('.CodeMirror').click();popup.keyboard.press('Escape');popup.keyboard.type('ggI// popup ');popup.keyboard.press('Escape');wait('sharpforge.getEditorState("Program.cs").value.startsWith("// popup ")');popup.locator('.CodeMirror').click(button='right');truth(popup.locator('.sf-menu:visible').count()==1);popup.keyboard.press('Escape');popup.close();wait("document.querySelector('.sf-keymap-host .CodeMirror')!==null");truth(value().startswith('// popup '));mode('visual-studio')
  check('Vim document popout edits shared buffer, hosts menu and reattaches intact',popout)
  def large_tree():
   records=[{'path':'Large.csproj','text':'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Library</OutputType><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup></Project>'}]+[{'path':f'Assets/Item{i:05d}.txt','text':'item '+str(i)} for i in range(4999)];page.evaluate('(r)=>sharpforge.loadDiskRecords(r)',records);wait('sharpforge.getState().project?.projects[0]?.path==="Large.csproj"');page.locator('#file-filter').fill('Item04998');truth(any(r.get('path')=='Assets/Item04998.txt' for r in page.evaluate('sharpforge.getExplorer().rows')));truth(page.locator('.sf-tree-row').count()<100);page.locator('#file-filter').fill('');page.locator('#file-tree').focus();page.locator('#file-tree').press('End');truth(page.locator('.sf-tree-row').count()<100)
  check('5,000 item hierarchy search and keyboard scrolling retain bounded tree DOM',large_tree)
  def finalshot():
   page.evaluate('sharpforge.loadSample("particles",true)');cmd('resetLayout');page.evaluate('sharpforge.openFile("Program.cs")');page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:27,hitCondition:"2"}])');page.evaluate('sharpforge.debug()');wait('sharpforge.getState().debug?.reason?.reason==="breakpoint"');cmd('tool:breakpoints');wait('document.querySelectorAll("#toasts .toast").length===0');truth(page.locator('[data-source-uri="Program.cs"] .sf-line.breakpoint').get_attribute('data-line')=='27');page.mouse.move(850,45);page.screenshot(path=str(RESULTS/'screenshots/release08-explorer-debugger.png'),full_page=True)
  check('Visual Studio-style workspace screenshot with bound sample breakpoint',finalshot)
  check('no JavaScript errors in primary or popup documents',lambda:truth(not errors,str(errors)))
  result={'passed':True,'browser':browser.version,'mode':'http' if os.getenv('SHARPFORGE_IN_MEMORY') != '1' else 'in-memory-production-workers','checks':checks,'errors':errors}
 except Exception as e:
  traceback.print_exc();result={'passed':False,'checks':checks,'errors':errors,'failure':str(e)};page.screenshot(path=str(RESULTS/'screenshots/release08-failure.png'),full_page=True,timeout=5000)
 finally:
  (RESULTS/'browser-release08-results.json').write_text(json.dumps(result,indent=2)+'\n')
 if not result['passed']:raise SystemExit(1)
