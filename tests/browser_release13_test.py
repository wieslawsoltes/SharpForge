"""C# source ownership, designer chrome and WinUI/BCL integration with production workers."""
import os,json,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application,wait_condition
ROOT=Path(__file__).resolve().parents[1];checks=[]
def truth(v,msg='assertion failed'):
 if not v:raise AssertionError(msg)
def check(name,fn):
 t=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-t)*1000,2)});print('PASS',name,flush=True)
SOURCE='''using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class View {
 static int clicks;
 static TextBlock label;
 static Window Create() {
  var window = new Window() { Title = "Synchronized studio" };
  var root = new Canvas() { Width = 860, Height = 560 };
  label = new TextBlock() { Name = "Caption", Text = "Keep my code", FontSize = 24, Width = 420 };
  Canvas.SetLeft(label, 40); Canvas.SetTop(label, 36);
  var button = new Button() { Name = "Action", Content = "Click", Width = 180, Height = 40 };
  Canvas.SetLeft(button, 40); Canvas.SetTop(button, 100);
  button.Click += OnClick;
  root.Children.Add(label); root.Children.Add(button);
  window.Content = root;
  return window;
 }
 // Keep this hand-written handler exactly, including Unicode: λ.
 static void OnClick(object sender, RoutedEventArgs e) { clicks++; label.Text = $"Clicks: {clicks:D2}"; }
 static void Main() { Create().Activate(); }
}'''
with sync_playwright() as p, launch_browser(p, __file__) as browser:
 b=browser;page=b.new_page(viewport={'width':1840,'height':1120});page.set_default_timeout(15000);errors=[];workers=[];page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('worker',lambda w:workers.append(w));page.on('dialog',lambda d:d.accept())
 def ev(code,arg=None):return page.evaluate(code,arg)
 def wait(code):return wait_condition(page,code,timeout=30000)
 def cmd(c):return ev('c=>sharpforge.execute(c)',c)
 def ds():return ev('sharpforge.designer.get()')
 def text():return ev('sharpforge.getState().files.find(f=>f.uri==="Program.cs").text')
 def node(id):return next(n for n in ds()['document']['nodes'] if n['id']==id)
 def edit(s):
  ev('sharpforge.openFile("Program.cs")')
  field=page.locator('[data-source-uri="Program.cs"] .sf-input')
  field.focus()
  field.press('ControlOrMeta+a')
  page.keyboard.insert_text(s)
  truth(text()==s,'Source input did not replace the complete document')
 designer_workers = {}
 def owned_workers():
  owners = ev('''() => {
    const services = sharpforge.workbenchServices;
    const builds = services.builds.list();
    const sessions = services.sessions.list();
    const all = [...builds, ...sessions];
    return {
      compilers: builds.map(owner => ({id: owner.id, name: owner.worker.options.name,
        generation: owner.worker.generation})),
      applications: sessions.map(owner => ({id: owner.id, name: owner.worker.options.name,
        generation: owner.worker.generation, identity: owner.identity})),
      resources: services.sessions.resources(),
      valid: all.every(owner => !owner.disposed && !owner.worker.disposed && !owner.worker.failed &&
        owner.worker.worker instanceof Worker),
      distinct: new Set(all.map(owner => owner.worker.worker)).size === all.length
    };
  }''')
  truth(owners['valid'] and owners['distinct'], 'Worker owners are failed, disposed or share a native Worker')
  truth([owner['id'] for owner in owners['compilers']] == ['$workspace'], 'The flat fixture needs one workspace compiler')
  resources = owners['resources']
  truth(resources['count'] == len(owners['applications']) <= resources['limit'], 'Runtime owner limit is inconsistent')
  truth(0 <= resources['live'] <= resources['count'], 'Live applications exceed retained owners')
  expected = sorted(owner['name'] for owner in owners['compilers'] + owners['applications'])
  deadline = time.monotonic() + 10
  while len(page.workers) != len(expected) and time.monotonic() < deadline:
   page.wait_for_timeout(20)
  live = list(page.workers)
  truth(len(live) == len(expected), 'Live workers do not match current owners: ' + str([worker.url for worker in live]))
  names = sorted(worker.evaluate('self.name') for worker in live)
  truth(names == expected, 'Live worker names do not match their owners: ' + str(names))
  return {'live': live, 'created': len(workers), 'owners': owners}
 def mark_designer_workers():
  designer_workers.clear()
  designer_workers.update(owned_workers())
 def assert_designer_workers():
  after = owned_workers()
  truth(after['created'] == designer_workers['created'], 'A designer operation created another worker')
  truth(set(after['live']) == set(designer_workers['live']), 'A designer operation replaced a live Worker')
  for kind in ['compilers', 'applications']:
   truth(after['owners'][kind] == designer_workers['owners'][kind], 'A designer operation replaced a worker owner')
 def designer_check(name, action):
  def guarded():
   action()
   assert_designer_workers()
  check(name, guarded)
 def assert_runtime_owner():
  current = owned_workers()
  truth(len(current['owners']['applications']) == 1, 'The fixture must own exactly one application worker')
  truth(current['owners']['resources']['live'] == 1, 'The launched application is not live')
  truth(ev('''() => {
    const session = sharpforge.workbenchServices.sessions.active;
    const debug = sharpforge.getState().debug;
    return session?.live && session.debug?.uiActive && debug?.uiActive &&
      debug.appId === session.id && debug.identity === session.identity &&
      debug.generation === session.worker.generation && debug.sessionId === session.identity &&
      debug.runtimeSessionId === session.runtimeSession;
  }'''), 'The selected debugger does not belong to the current live runtime worker')
 def load(s):
  cmd('stop')
  ev('sharpforge.designer.disconnect()')
  ev('text=>sharpforge.loadDiskRecords([{path:"Program.cs",text}],{name:"SourceSyncWorkshop"})',s)
  ev('sharpforge.build()')
  truth(not ev('sharpforge.getState().diagnostics.filter(d=>d.severity==="error")'),str(ev('sharpforge.getState().diagnostics')))
  mark_designer_workers()
  ev('sharpforge.designer.open()')
 try:
  load_application(page)
  def connect():
   load(SOURCE);ev('sharpforge.designer.connect("Program.cs")');truth(ds()['sourceSync']['state']=='synced',str(ds()));truth(node('button')['properties']['Width']==180);truth(page.locator('.design-preview [data-sf-id="button"]').count()==1);truth('OnClick' in text())
  designer_check('connect an existing hand-written construction method without replacing source or workers',connect)
  def chrome():
   truth(page.locator('[data-design-view="split"]').get_attribute('aria-selected')=='true');ev('sharpforge.openTool("designer-properties");sharpforge.designer.select("button")');truth(page.locator('.design-property-category summary').count()>=4);truth(page.locator('.design-breadcrumbs').inner_text().find('Action')>=0);truth(page.locator('[data-property="Width"]').get_attribute('aria-label')=='Width');truth(page.locator('[data-property=ColumnSpan]').count()==0);truth(page.locator('[data-property=Left]').count()==1);truth(page.locator('[data-design-goto-source]').count()==1);truth(page.locator('.design-mode-tabs').is_visible());truth(page.locator('.design-mode-bar').evaluate('e=>getComputedStyle(e).display')=='flex');truth(page.locator('.design-toolbox-category svg').first.evaluate('e=>getComputedStyle(e).fill')=='none')
  designer_check('designer modes, grouped property grid, breadcrumb selection and compact chrome initialize',chrome)
  def property_write():
   before=text();ev('sharpforge.designer.set("Width",248,["button"])');wait('sharpforge.designer.get().sourceSync.state==="synced"');after=text();truth('Width = 248' in after,after);truth(after==before.replace('Width = 180','Width = 248.0'),'write was not a minimal source span edit');truth(not ev('sharpforge.getState().diagnostics.filter(d=>d.severity==="error")'),str(ev('sharpforge.getState().diagnostics')))
  designer_check('designer property changes compile-check a minimal C# edit and preserve every other byte',property_write)
  def editor_read():
   edit(text().replace('"Keep my code"','"Edited in C#"'));wait('sharpforge.designer.get().document.nodes.some(n=>n.id==="label"&&n.properties.Text==="Edited in C#")');truth(page.locator('.design-preview [data-sf-id="label"]').inner_text()=='Edited in C#');truth(ds()['sourceSync']['state']=='synced')
  designer_check('real source editor input updates the design preview automatically',editor_read)
  def source_undo():
   ev('sharpforge.openFile("Program.cs")');cmd('undo');wait('sharpforge.designer.get().document.nodes.find(n=>n.id==="label").properties.Text==="Keep my code"');cmd('redo');wait('sharpforge.designer.get().document.nodes.find(n=>n.id==="label").properties.Text==="Edited in C#"')
  designer_check('source undo and redo resynchronize the preview without replacing the editor',source_undo)
  def incomplete():
   before=text();edit(before.replace('Width = 248.0','Width ='));wait('sharpforge.designer.get().sourceSync.state==="blocked"');truth(node('button')['properties']['Width']==248);edit(before);wait('sharpforge.designer.get().sourceSync.state==="synced"')
  designer_check('incomplete C# keeps the last valid preview and recovers when corrected',incomplete)
  def structural():
   ev('sharpforge.designer.setAutoSync(false)');id_=ev('sharpforge.designer.add("TextBox","root")');ev('id=>sharpforge.designer.set("Text","New input",[id])',id_);ev('sharpforge.designer.writeSource()');truth('New input' in text());truth('// Keep this hand-written handler exactly, including Unicode: λ.' in text());truth('clicks++; label.Text = $"Clicks: {clicks:D2}";' in text());truth(not ev('sharpforge.getState().diagnostics.filter(d=>d.severity==="error")'),str(ev('sharpforge.getState().diagnostics')))
  designer_check('structural insertion rewrites only the proven construction method and preserves the hand-written handler',structural)
  def conflict():
   ev('sharpforge.designer.set("Width",260,["button"])');staged=text();edit(staged.replace('"Click"','"From source"'));wait('sharpforge.designer.get().sourceSync.state==="conflict"');message=ev('async()=>{try{await sharpforge.designer.writeSource();return ""}catch(e){return e.message}}');truth(message);truth(text()==staged.replace('"Click"','"From source"'));ev('sharpforge.designer.readSource({discardDesign:true})');truth(node('button')['properties']['Content']=='From source');truth(node('button')['properties']['Width']==248)
  designer_check('concurrent source and designer edits are rejected without overwriting either side',conflict)
  def dynamic():
   s=SOURCE.replace('Width = 180','Width = CalculateWidth()').replace('static int clicks;','static int clicks; static int CalculateWidth(){return 215;}');load(s);ev('sharpforge.designer.connect("Program.cs");sharpforge.designer.select("button");sharpforge.openTool("designer-properties")');truth(page.locator('[data-property="Width"]').is_disabled());ev('sharpforge.designer.setAutoSync(false);sharpforge.designer.set("Height",52,["button"])');ev('sharpforge.designer.writeSource()');truth('Width = CalculateWidth()' in text());truth('Height = 52' in text())
  designer_check('dynamic C# expressions stay code-owned while independent scalar properties remain editable',dynamic)
  def device():
   load(SOURCE);ev('sharpforge.designer.connect("Program.cs");sharpforge.designer.setAutoSync(false)');page.locator('[data-device-preset]').select_option('390x844');truth(ds()['document']['width']==390);ev('sharpforge.designer.setView("preview")');truth(ds()['viewMode']=='preview');ev('sharpforge.designer.setView("design")');truth(ds()['viewMode']=='design');ev('sharpforge.designer.setView("split")');truth(ds()['viewMode']=='split');page.screenshot(path=str(RESULTS/'screenshots/release13-designer-sync.png'))
  designer_check('device presets and Design/Split/C#/Preview views use the original editor and artboard',device)
  def run_handlers():
   ev('sharpforge.designer.writeSource()')
   cmd('winuiLayout')
   ev('sharpforge.run()')
   wait('sharpforge.getState().debug?.uiActive')
   ev('sharpforge.uiSettled()')
   assert_runtime_owner()
   ev('''async()=>{
     const scene=await sharpforge.getUIScene();
     await sharpforge.dispatchUIEvent(scene.nodes.find(n=>n.properties.Name==="Action").id,"Click",{});
   }''')
   wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Clicks: 01")')
   cmd('stop')
  check('synchronized source builds and runs its retained C# event handler and formatted interpolation',run_handlers)
  def js_animations():
   result=ev('''async()=>{const {createWinUIApp}=await __sharpforgeTestImport('/packages/winui/src/index.js');const root=document.createElement('div');root.id='animation13';Object.assign(root.style,{position:'fixed',left:'100px',top:'120px',width:'680px',height:'450px',background:'#171b25',zIndex:99999});document.body.append(root);const app=createWinUIApp(root,{backend:'dom',animationManual:true}),X=app.Microsoft.UI.Xaml,C=X.Controls,A=X.Media.Animation,T=app.System.TimeSpan;const w=new X.Window(),panel=new C.Canvas(),b=new C.Button();b.Content='Animated';b.Width=160;b.Height=48;b.Opacity=.6;b.RenderTransform=new X.Media.TranslateTransform();panel.Children.Add(b);w.Content=panel;w.Activate();const a=new A.DoubleAnimation();a.From=0;a.To=1;a.Duration=new X.Duration(T.FromSeconds(1));A.Storyboard.SetTarget(a,b);A.Storyboard.SetTargetProperty(a,'Opacity');const s=new A.Storyboard();s.Children.Add(a);let completed=0;s.Completed.add(()=>completed++);s.Begin();app.advanceAnimations(500);const half=b.Opacity;b.Opacity=.8;const local=b.ReadLocalValue(C.Button.OpacityProperty);s.Stop();const restored=b.Opacity;const move=new A.DoubleAnimation();move.From=0;move.To=160;move.Duration=new X.Duration(T.FromSeconds(1));A.Storyboard.SetTarget(move,b);A.Storyboard.SetTargetProperty(move,'RenderTransform.X');s.Children.Clear();s.Children.Add(move);s.Begin();app.advanceAnimations(500);await app.settled();const transform=app.host.elements.get(b.$node.id).style.transform;s.SkipToFill();const complete=completed;window.__animation13={app,X,C,A,T,w,panel,b,s};return {half,local,restored,transform,complete};}''');truth(result=={'half':.5,'local':.8,'restored':.8,'transform':'translate(80px, 0px)','complete':1},str(result))
  check('independent JavaScript storyboard interpolates actual controls, transforms and local-value restoration',js_animations)
  def wrap():
   result=ev('''()=>{const {app,C,w}=__animation13;const panel=new C.VariableSizedWrapGrid();panel.Width=480;panel.Height=200;panel.ItemWidth=120;panel.ItemHeight=48;panel.MaximumRowsOrColumns=3;panel.Orientation=C.Orientation.Horizontal;const nodes=[];for(let i=0;i<5;i++){const b=new C.Button();b.Content='Card '+i;panel.Children.Add(b);nodes.push(b);}C.VariableSizedWrapGrid.SetColumnSpan(nodes[0],2);w.Content=panel;app.flush();const boxes=nodes.map(n=>{const e=app.host.elements.get(n.$node.id),r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width}});return boxes;}''');truth(abs(result[0]['w']-240)<2,str(result));truth(result[2]['y']>result[0]['y'],str(result));page.screenshot(path=str(RESULTS/'screenshots/release13-wrap-panels.png'));ev('__animation13.app.dispose();document.getElementById("animation13").remove()')
  check('VariableSizedWrapGrid lays out measured two-cell spans and wraps following items',wrap)
  anim='''using System;using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;using Microsoft.UI.Xaml.Media;using Microsoft.UI.Xaml.Media.Animation;class Program {static Storyboard storyboard;static TextBlock label;static void Finished(object s,RoutedEventArgs e){label.Text="Complete";}static void Main(){var w=new Window();var p=new StackPanel();label=new TextBlock(){Name="Status",Text="Waiting"};var b=new Button(){Name="Animated",Content="Motion",Opacity=0.1};b.RenderTransform=new TranslateTransform();var a=new DoubleAnimation(){From=0,To=100,Duration=new Duration(TimeSpan.FromMilliseconds(200))};Storyboard.SetTarget(a,b);Storyboard.SetTargetProperty(a,"RenderTransform.X");storyboard=new Storyboard();storyboard.Children.Add(a);storyboard.Completed+=Finished;p.Children.Add(label);p.Children.Add(b);w.Content=p;w.Activate();storyboard.Begin();}}'''
  for direct in [False,True]:
   def auto_clock(direct=direct):
    load(anim)
    cmd('winuiLayout')
    ev('sharpforge.invokeAssembly(sharpforge.getAssembly(),null,[],{debug:false})' if direct else 'sharpforge.run()')
    wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Complete")')
    assert_runtime_owner()
    ev('sharpforge.uiSettled()')
    actual=page.locator('.sf-winui [data-name="Animated"]').evaluate('e=>e.style.transform')
    truth(actual=='translate(100px, 0px)',actual+str(ev('sharpforge.getUIScene()')))
    cmd('stop')
   check(('direct CIL' if direct else 'source VM')+' real worker clock animates after Main and runs managed Completed handler',auto_clock)
  def final():
   cmd('stop')
   ev('sharpforge.designer.disconnect()')
   ev('sharpforge.loadSample("designer-csharp-sync",true)')
   mark_designer_workers()
   truth(not designer_workers['owners']['applications'], 'Workspace replacement retained a runtime session')
   ev('sharpforge.designer.open();sharpforge.designer.connect("Program.cs");'
      'sharpforge.designer.select("action");sharpforge.openTool("designer-properties");sharpforge.designer.action("fit")')
   page.locator('[data-design-goto-source]').click()
   truth(ev('sharpforge.getEditorState("Program.cs").start')==text().index('var action ='))
   page.wait_for_timeout(300)
   page.screenshot(path=str(RESULTS/'screenshots/release13-designer-sync.png'))
   cmd('theme')
   page.wait_for_timeout(100)
   truth(ev('getComputedStyle(document.querySelector(".design-mode-bar")).backgroundColor')=='rgb(237, 242, 247)')
   page.screenshot(path=str(RESULTS/'screenshots/release13-designer-light.png'))
   cmd('theme')
   truth(not errors,json.dumps(errors))
   assert_designer_workers()
  check('all integration workflows finish without page errors or unowned and churned workers',final)
  report = {
   'checks': checks, 'errors': errors, 'workers': len(workers), 'liveWorkers': len(page.workers),
   'workerOwners': owned_workers()['owners'],
   'workerHistory': [{'id': index+1, 'url': worker.url} for index, worker in enumerate(workers)],
   'harness': 'in-memory production modules and real workers' if os.getenv('SHARPFORGE_IN_MEMORY') == '1'
     else 'CSP HTTP and real workers'
  }
  (RESULTS/'browser-release13-validation.json').write_text(json.dumps(report,indent=2), encoding='utf-8')
  print(json.dumps({'passed':len(checks),'errors':errors}),flush=True)
 except Exception:
  traceback.print_exc();print('ERRORS',errors,flush=True);print('DESIGN',json.dumps(ds())[:3500],flush=True);print('STATE',json.dumps(ev('sharpforge.getState().diagnostics'))[:2500],flush=True);page.screenshot(path=str(RESULTS/'screenshots/release13-failure.png'));raise
