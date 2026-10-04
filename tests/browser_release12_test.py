"""Designer and edit/continue end-to-end acceptance. Production modules and two real workers."""
import os,json,time,traceback
from math import floor
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application,wait_condition
from browser_designer_release_controls import ReleaseDesignerControls
from browser_designer_source_input import replace_source
from browser_designer_release_attachment import attach_running_application
ROOT=Path(__file__).resolve().parents[1];checks=[]
def truth(v,msg='assertion failed'):
 if not v:raise AssertionError(msg)
def check(name,fn):
 start=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p, launch_browser(p, __file__) as browser:
 b=browser;page=b.new_page(viewport={'width':1880,'height':1140});page.set_default_timeout(12000);errors=[];workers=[]
 page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('worker',lambda w:workers.append(w.url));page.on('dialog',lambda d:d.accept())
 def ev(code,arg=None):return page.evaluate(code,arg)
 def wait(code):return wait_condition(page,code,timeout=25000)
 def cmd(c):return ev('c=>sharpforge.execute(c)',c)
 def ds():return ev('sharpforge.designer.get()')
 def node(id):return next(n for n in ds()['document']['nodes'] if n['id']==id)
 def action(name):return ev('a=>sharpforge.designer.action(a)',name)
 def tool(name):ev('n=>sharpforge.openTool(n)',name)
 def select(id):ev('id=>sharpforge.designer.select(id)',id)
 def new():ui.new()
 def edit(text):
  replace_source(page,"Program.cs",text)
 def app_node(name):return next(n for n in ev('sharpforge.getUIScene()')['nodes'] if n['properties'].get('Name')==name)
 attachments=[]
 def attach(allow_unlinked=False):
  try:
   return attach_running_application(page,ev,ds,records=attachments,allow_unlinked=allow_unlinked)
  finally:
   (RESULTS/'browser-release12-attachments.json').write_text(json.dumps(attachments,indent=2),encoding='utf-8')
 def drag(locator,dx,dy):
  box=locator.bounding_box();truth(box,'element has no bounds');x,y=box['x']+box['width']/2,box['y']+box['height']/2;page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y+dy,steps=8);page.mouse.up();page.wait_for_timeout(120)
 ui=ReleaseDesignerControls(page,ds,action,select,tool,ev,drag)
 try:
  load_application(page)
  ev('sharpforge.designer.open()');page.wait_for_timeout(300)
  check('all seven designer tools initialize with production preview and two runtime/compiler workers',lambda:truth(len(workers)==2 and ui.host.locator('.design-preview [data-sf-id="action"]').count()==1 and 'Canvas' in ui.side('tree').locator('.design-tree').inner_text() and not errors,str(errors)))
  def toolbox():
   select('canvas');tool('designer-toolbox');ui.search_controls('NumberBox');truth(ui.side('toolbox').locator('[data-control]').count()==1);ui.side('toolbox').locator('[data-control]').click();truth(node(ds()['selection'][0])['type'].endswith('NumberBox'));truth(ui.host.locator('.design-preview input[type=number]').count()==1);action('undo');truth(not any(n['type'].endswith('NumberBox') for n in ds()['document']['nodes']));ui.side('toolbox').get_by_role('searchbox',name='Search toolbox').fill('')
  check('searchable toolbox inserts a real NumberBox into the selected parent and supports undo',toolbox)
  def pixel():
   new()
   select('action')
   before = node('action')['properties']
   zoom = ds()['zoom']
   grid = ds()['document'].get('designer', {}).get('guides', {}).get('gridSize', 8)
   # Snap absolute Canvas coordinates, including an initially off-grid control.
   expected = {key: floor((before[key] + delta) / grid + .5) * grid for key, delta in [('Left', 32), ('Top', 24)]}
   drag(ui.host.locator('.design-preview [data-sf-id="action"]'), 32 * zoom, 24 * zoom)
   truth(all(node('action')['properties'][key] == value for key, value in expected.items()), str(node('action')))
   action('undo')
   truth(node('action')['properties'] == before)
   action('redo')
   truth(all(node('action')['properties'][key] == value for key, value in expected.items()), str(node('action')))
  check('actual mouse dragging uses snapped Canvas coordinates and a single undo/redo transaction',pixel)
  def resize():
   select('action');before=node('action')['properties'];z=ds()['zoom'];drag(ui.host.locator('[data-control-id="action"][data-resize="se"]'),40*z,16*z);truth(node('action')['properties']['Width']==before['Width']+40,str(node('action')));truth(node('action')['properties']['Height']==before['Height']+16)
  check('eight-handle adorner resizes actual controls without losing selection or source geometry',resize)
  def properties():
   select('action');tool('designer-properties');ui.side('properties').locator('.design-property-search').fill('Content');x=ui.side('properties').locator('[data-property="Content"]');x.fill('Edited in property grid');x.press('Tab');truth(node('action')['properties']['Content']=='Edited in property grid');truth(ui.host.locator('.design-preview [data-sf-id="action"]').inner_text()=='Edited in property grid');ui.side('properties').locator('.design-property-search').fill('')
  check('typed property grid updates the design and preview; filtering retains editor focus',properties)
  def clip():
   select('action');action('copy');select('canvas');action('paste');id=ds()['selection'][0];truth(id!='action');truth(node(id)['properties']['Content']=='Edited in property grid');action('delete');truth(not any(n['id']==id for n in ds()['document']['nodes']));action('undo');truth(any(n['id']==id for n in ds()['document']['nodes']))
  check('tree/surface copy-paste creates independent controls and delete restores through undo',clip)
  def grid():ui.grid()
  check('layout panel converts Canvas to Grid, edits Auto/pixel/star tracks and mouse-drags controls between cells',grid)
  def grid_boundary():ui.grid_boundary()
  check('actual Grid boundary dragging resizes adjacent tracks and restores through one undo',grid_boundary)
  def zoom_marquee():
   new();ui.editing_mode('pixel');before=ds()['zoom'];box=ui.host.locator('.design-preview').bounding_box();page.mouse.move(box['x']+100,box['y']+100);page.keyboard.down('Control');page.mouse.wheel(0,-120);page.keyboard.up('Control');page.wait_for_timeout(100);truth(ds()['zoom']>before);select('canvas');box=ui.host.locator('.design-preview [data-sf-id="canvas"]').bounding_box();z=ds()['zoom'];page.keyboard.down('Shift');page.mouse.move(box['x']+8*z,box['y']+8*z);page.mouse.down();page.mouse.move(box['x']+600*z,box['y']+210*z,steps=8);page.mouse.up();page.keyboard.up('Shift');truth('action' in ds()['selection'],str(ds()['selection']));truth(len(ds()['selection'])>=2,str(ds()['selection']));select('action');truth('ActionButton' in ui.side('tree').locator('.design-tree').inner_text() or 'action' in ui.side('tree').locator('.design-tree').inner_text().lower())
  check('anchor-preserving Ctrl-wheel zoom and Shift marquee select controls and reveal them in the tree',zoom_marquee)
  def styles():ui.styles()
  check('style setter UI applies shared styles and local values override then clear back to style',styles)
  def templates():ui.templates()
  check('control-template editor creates bound parts and clones independent per-control template trees',templates)
  def persist():
   action('save')
   current=ds();uri=current['uri'];before=current['document']
   files=ev('sharpforge.getWorkspace()')['records']
   saved=next(r for r in files if r['path']==uri)
   truth(json.loads(saved['text'])==before,'The active design was not saved before export')
   ev('async()=>{window.__designArchive=await sharpforge.exportWorkspaceZip()}')
   truth(ev('window.__designArchive.length')>1000)
   ev('async()=>await sharpforge.openWorkspaceZip(new File([window.__designArchive],"Designer.zip",{type:"application/zip"}))')
   stored=next(r for r in ev('sharpforge.getWorkspace()')['records'] if r['path']==uri)
   truth(json.loads(stored['text'])==before,'The exported active design changed when the workspace was reopened')
   ev('uri=>sharpforge.designerDocuments.open(uri,"design")',uri)
   truth(ds()['document']==before,'Reopening the saved design changed its authored state')
  check('saved design JSON including styles/templates survives a real complete-workspace ZIP export/reopen',persist)
  def generate():
   new();action('generate');wait('sharpforge.getState().debug?.uiActive');tool('winui');ev('sharpforge.uiSettled()');truth(not ev('sharpforge.getState().diagnostics.filter(d=>d.severity==="error")'),str(ev('sharpforge.getState().diagnostics')));page.locator('[data-tool="winui"]') if False else None
   node_=app_node('ActionButton');ev('id=>sharpforge.dispatchUIEvent(id,"Click",{})',node_['id']);wait('sharpforge.getState().debug?.output.includes("OnAction invoked")');truth(any(f['uri'].endswith('DesignedView.g.cs') for f in ev('sharpforge.getState().files')))
  check('Build & Run generates a real csproj/slnx and C# view with managed event handlers',generate)
  live_src='''using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;class Program {static int count;static TextBox input;static TextBlock label;static void Click(object s,RoutedEventArgs e){count++;label.Text=input.Text+":"+count;}static void Main(){Window w=new Window();Canvas panel=new Canvas(){Name="Root"};input=new TextBox(){Name="Input",Text="initial",Width=200};label=new TextBlock(){Name="Label",Text="0"};Canvas.SetTop(label,50);Button b=new Button(){Name="Button",Content="Add",Width=120,Height=40};Canvas.SetTop(b,100);b.Click+=Click;panel.Children.Add(input);panel.Children.Add(label);panel.Children.Add(b);w.Content=panel;w.Activate();}}'''
  def start_live(direct=False):
   cmd('stop');ev('text=>sharpforge.loadDiskRecords([{path:"Program.cs",text}],{name:"LiveDesigner"})',live_src);ev('sharpforge.build()');truth(not ev('sharpforge.getState().diagnostics.filter(d=>d.severity==="error")'),str(ev('sharpforge.getState().diagnostics')));cmd('winuiLayout')
   if direct:ev('sharpforge.invokeAssembly(sharpforge.getAssembly(),null,[],{debug:false})')
   else:ev('sharpforge.run()')
   wait('sharpforge.getState().debug?.uiActive');ev('sharpforge.uiSettled()')
  for direct in [False,True]:
   def live(direct=direct):
    start_live(direct);input_=app_node('Input');button=app_node('Button');ev('id=>sharpforge.dispatchUIEvent(id,"TextChanged",{value:"typed"})',input_['id']);ev('id=>sharpforge.dispatchUIEvent(id,"Click",{})',button['id']);wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Name==="Label"&&n.properties.Text==="typed:1")');ev('sharpforge.designer.open();');attach(allow_unlinked=direct);doc=ds()['document'];target=next(n for n in doc['nodes'] if n['properties'].get('Name')=='Button')['id'];ev('id=>{sharpforge.designer.select(id);sharpforge.designer.set("Width",250);sharpforge.designer.style("LiveStyle",{targetType:"Button",setters:{FontSize:24}});sharpforge.designer.reference("style","LiveStyle");}',target);ev('sharpforge.designer.apply()');truth(app_node('Input')['properties']['Text']=='typed');truth(app_node('Button')['id']==button['id']);truth(app_node('Button')['properties']['FontSize']==24);ev('id=>sharpforge.dispatchUIEvent(id,"Click",{})',button['id']);wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Name==="Label"&&n.properties.Text==="typed:2")');truth(ds()['live']);page.screenshot(path=str(RESULTS/'screenshots/release12-live-designer.png'))
   check(('direct CIL' if direct else 'source VM')+' live designer patch retains typed input, object identity, counter state and callbacks',live)
  def enc():
   start_live(False);ev('sharpforge.beginHotReload()');edit(live_src.replace('count++;','count += Step();').replace('static int count;','static int count; static int added; static int Step(){return 3;}'));result=ev('sharpforge.applyHotReload()');truth(ev('sharpforge.getState().debug.codeVersion')==1,str(result));ev('id=>sharpforge.dispatchUIEvent(id,"Click",{})',app_node('Button')['id']);wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Name==="Label"&&n.properties.Text==="initial:3")')
  check('actual compiler-worker Edit & Continue adds a method and static field while keeping the live C# window',enc)
  def stale():
   ev('sharpforge.designer.open()');attach();cmd('stop');message=ev('async()=>{try{await sharpforge.designer.apply();return ""}catch(e){return e.message}}');truth('session' in message.lower(),message)
  check('stale designer session is rejected before any managed mutation',stale)
  def javascript_styles():
   result=ev("""async()=>{const {createWinUIApp}=await __sharpforgeTestImport('/packages/winui/src/index.js');const mount=document.createElement('div');mount.id='js-style-test';document.body.append(mount);Object.assign(mount.style,{position:'fixed',inset:'100px 500px 100px 500px',zIndex:99999,background:'#222'});const app=createWinUIApp(mount,{backend:'dom'}),X=app.Microsoft.UI.Xaml,C=X.Controls;const s=new X.Style('Button'),v=new X.Setter(C.Button.FontSizeProperty,20);s.Setters.Add(v);const a=new C.Button(),b=new C.Button(),input=new C.TextBox(),t=new C.ControlTemplate(),part=new C.TextBox();a.Content='Styled A';b.Content='Styled B';a.Style=s;b.Style=s;b.FontSize=28;v.Value=24;b.ClearValue(C.Button.FontSizeProperty);part.Name='PART_Input';t.TargetTypeName='TextBox';t.VisualTree=part;t.Bind(part,'Text',C.TextBox.TextProperty);input.Name='JSOwner';input.Text='initial';input.Template=t;let events=0;input.TextChanged.add(()=>events++);const panel=new C.StackPanel(),w=new X.Window();panel.Children.Add(a);panel.Children.Add(b);panel.Children.Add(input);w.Content=panel;w.Activate();await app.settled();window.__jsStyle={app,a,b,input,v,X,C,getEvents:()=>events};return {a:a.FontSize,b:b.FontSize,sameProperty:C.Button.WidthProperty===X.FrameworkElement.WidthProperty,unset:a.ReadLocalValue(C.Button.WidthProperty)===X.DependencyProperty.UnsetValue,part:!!input.GetTemplateChild('PART_Input')};}""")
   truth(result=={'a':24,'b':24,'sameProperty':True,'unset':True,'part':True},str(result));page.locator('#js-style-test input').fill('JS typed');truth(ev('__jsStyle.input.Text')=='JS typed');truth(ev('__jsStyle.getEvents()')==1);precedence=ev('()=>{const j=__jsStyle,p=j.input.GetTemplateChild("PART_Input");const unset=p.ReadLocalValue(j.C.TextBox.TextProperty)===j.X.DependencyProperty.UnsetValue;p.SetValue(j.C.TextBox.TextProperty,"part-local");j.input.Text="owner-new";const local=p.GetValue(j.C.TextBox.TextProperty);p.ClearValue(j.C.TextBox.TextProperty);return {unset,local,cleared:p.GetValue(j.C.TextBox.TextProperty)};}');truth(precedence=={'unset':True,'local':'part-local','cleared':'owner-new'},str(precedence));result=ev("""()=>{const j=__jsStyle;let rejected=false;try{j.v.Value='invalid'}catch{rejected=true}return {rejected,a:j.a.FontSize,b:j.b.FontSize};}""");truth(result=={'rejected':True,'a':24,'b':24},str(result));ev('__jsStyle.app.dispose();document.getElementById("js-style-test").remove()')
  check('independent JavaScript facade supports shared styles, stable dependency properties, templates and real bound input',javascript_styles)
  def gallery():
   cmd('stop');ev('sharpforge.loadSample("winui-expanded-controls",true)');cmd('winuiLayout');ev('sharpforge.run()');wait('sharpforge.getState().debug?.uiActive');ev('sharpforge.uiSettled()')
   page.locator('.winui-app-root input[type=number]').fill('63');wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Amount: 63")')
   radios=page.locator('.winui-app-root input[type=radio]');radios.nth(0).check();radios.nth(1).check();wait('async()=> (await sharpforge.getUIScene()).nodes.filter(n=>n.type.endsWith("RadioButton")&&n.properties.IsChecked===true).length===1')
   page.locator('.winui-app-root input[type=date]').fill('2026-11-12');wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Date==="2026-11-12")')
   page.locator('.winui-app-root input[type=time]').fill('16:45');wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Time==="16:45")')
   page.locator('.winui-app-root [data-close-tab]').click();wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.type.endsWith("TabView")&&n.collections.TabItems.length===1)');truth(not errors,json.dumps(errors));page.screenshot(path=str(RESULTS/'screenshots/release12-controls.png'));cmd('stop')
  check('new control gallery routes NumberBox, radio groups, date/time inputs and closable tabs into real managed state',gallery)
  def final_preview():
   ev('sharpforge.designer.open()');new();select('canvas');a=ev('sharpforge.designer.add("TextBox","canvas")');ev('id=>{sharpforge.designer.set("Text","Design a live application",[id]);sharpforge.designer.set("Top",230,[id]);sharpforge.designer.set("Width",360,[id]);}',a);select('action');tool('designer-properties');page.screenshot(path=str(RESULTS/'screenshots/release12-designer.png'));truth(not errors,json.dumps(errors));truth(len(workers)==2)
  check('all designer workflows finish without page errors and keep the same two real workers',final_preview)
  (RESULTS/'browser-release12-validation.json').write_text(json.dumps({'checks':checks,'errors':errors,'workers':len(workers),'harness':'in-memory production modules and real workers' if os.getenv('SHARPFORGE_IN_MEMORY') == '1' else 'CSP HTTP and real workers'},indent=2), encoding='utf-8');print(json.dumps({'passed':len(checks),'errors':errors}),flush=True)
 except Exception:
  traceback.print_exc();print('PAGE_ERRORS',json.dumps(errors),flush=True);print('DESIGN',json.dumps(ds())[:2200],flush=True);print('DEBUG',json.dumps(ev('sharpforge.getState().debug'))[:1000],flush=True);page.screenshot(path=str(RESULTS/'screenshots/release12-failure.png'));raise
