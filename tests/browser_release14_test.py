"""Production IDE/VM/worker/SIMD and real loopback HTTP from Chromium.
HTML navigation is not qualified by this in-memory harness. Fetch is NOT mocked.
"""
import os,json,time,threading,traceback
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from browser_harness import load_in_memory,wait_condition
ROOT=Path(__file__).resolve().parents[1];checks=[];requests=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_OPTIONS(self):
  self.send_response(204);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','content-type,x-demo');self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS');self.end_headers()
 def respond(self,body):
  self.send_response(200);self.send_header('Access-Control-Allow-Origin','*');self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers()
  try:self.wfile.write(body)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):
  requests.append({'path':self.path,'cookie':self.headers.get('Cookie'),'method':'GET'})
  if self.path=='/slow':time.sleep(.25)
  self.respond(b'{"message":"Browser reached real local server","answer":42}')
 def do_POST(self):
  body=self.rfile.read(int(self.headers.get('Content-Length','0')));requests.append({'path':self.path,'body':body.decode(),'method':'POST','header':self.headers.get('x-demo')});self.respond(body)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
def truth(v,msg='assertion failed'):
 if not v:raise AssertionError(msg)
def check(name,fn):
 t=time.perf_counter();fn();checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-t)*1000,2)});print('PASS',name,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.getenv('CHROMIUM_EXECUTABLE') else {}),headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':1840,'height':1120});page.set_default_timeout(15000);errors=[];workers=[];page.on('pageerror',lambda e:errors.append(e.stack or str(e)));page.on('worker',lambda w:workers.append(w.url));page.on('dialog',lambda d:d.accept())
 def ev(code,arg=None):return page.evaluate(code,arg)
 def wait(code):return wait_condition(page,code,timeout=30000)
 def state():return ev('sharpforge.getState()')
 def stop():return ev('sharpforge.execute("stop")')
 def load(id):ev('id=>sharpforge.loadSample(id)',id);truth(not [d for d in state()['diagnostics'] if d['severity']=='error'],str(state()['diagnostics']))
 def source(text):stop();ev('text=>sharpforge.loadDiskRecords([{path:"Program.cs",text}],{name:"RuntimeQualification"})',text);ev('sharpforge.build()');truth(not [d for d in state()['diagnostics'] if d['severity']=='error'],str(state()['diagnostics']))
 def run():ev('sharpforge.run()');wait('sharpforge.getState().debug?.state==="terminated"');r=state()['debug'];truth(not r['fault'],str(r));return r
 def configure(value):return ev('s=>sharpforge.configureRuntime(s)',value)
 try:
  load_in_memory(page)
  def defaults():
   truth(len(workers)==2);truth(ev('sharpforge.getKeymap().id')=='visual-studio');s=ev('sharpforge.getRuntimeSettings()');truth(s['langVersion']=='14' and not s['enabled']);ev('sharpforge.openTool("runtime-settings")');truth(page.locator('#runtime-network').is_visible());truth(not page.locator('#runtime-network').is_checked());truth(page.locator('#runtime-backend').input_value()=='auto')
  check('stable default language, Visual Studio keys, and explicit-deny runtime panel',defaults)
  def preview():
   load('csharp-preview-collections');truth(ev('sharpforge.getRuntimeSettings().langVersion')=='preview');truth(run()['output']=='1,2,3,4\n22\n');stop();configure({'langVersion':'14'});ev('sharpforge.build()');truth(any('preview' in d['message'].lower() or '15' in d['message'] for d in state()['diagnostics']));configure({'langVersion':'preview'});ev('sharpforge.build()');truth(not [d for d in state()['diagnostics'] if d['severity']=='error'],str(state()['diagnostics']))
  check('preview language selection gates capacity expressions and labeled loops in compiler worker',preview)
  def modern():
   load('csharp-modern-properties');truth(run()['output']=='42\n0\n');load('bcl-json-document');truth(run()['output']=='items: 3\nTotal: 42\n{"total":42}\n');load('bcl-array-random');truth(run()['output'].endswith('534011718\n237820880\n'))
  check('field-backed properties, conditional assignment, JSON, array helpers and seeded Random execute',modern)
  def simd():
   load('simd-vector-math');r=run();truth(r['output']=='20\n32\n14\n');truth(r['runtime']['simd']['backend']=='wasm-simd128',str(r));truth(r['runtime']['simd']['calls']>=5)
  check('managed Vector operations execute actual WebAssembly SIMD in the runtime worker',simd)
  def fallback():
   stop();configure({'compute':{'backend':'scalar'}});r=run();truth(r['output']=='20\n32\n14\n');truth(r['runtime']['simd']['backend']=='scalar')
  check('explicit scalar fallback preserves vector results and reports actual backend',fallback)
  def actual_pool():
   r=ev('''async()=>{const {ComputePool}=await __sharpforgeTestImport('/packages/compute/src/index.js');const pool=new ComputePool({workers:2,backend:'wasm'});try{await pool.init();const a=new Float64Array(100000).fill(.5);const jobs=Array.from({length:6},()=>pool.execute('sum',a));a[0]=99;return {values:await Promise.all(jobs),bytes:a.byteLength,caps:await pool.capabilities()};}finally{pool.dispose();}}''');truth(r['values']==[50000]*6,str(r));truth(r['bytes']==800000);truth(r['caps']['maxActive']==2);truth(len(r['caps']['slots'])==2 and all(s['backend']=='wasm-simd128' for s in r['caps']['slots']))
  check('independent compute package uses two real browser workers with owned transferable inputs',actual_pool)
  def pool_cancel():
   r=ev('''async()=>{const {ComputePool}=await __sharpforgeTestImport('/packages/compute/src/index.js');const pool=new ComputePool({workers:1,backend:'scalar'});try{const controller=new AbortController();const one=pool.execute('sum',new Float64Array([42]));const two=pool.execute('sum',new Float64Array([1]),null,{signal:controller.signal}).then(()=>null,e=>e.name);controller.abort();return {one:await one,canceled:await two};}finally{pool.dispose();}}''');truth(r=={'one':42,'canceled':'AbortError'},str(r))
  check('compute cancellation rejects a queued job and leaves following work usable',pool_cancel)
  def managed_pool():
   load('parallel-compute');configure({'compute':{'backend':'auto','workers':2}});r=run();truth(r['output']=='sum: 6\ndot: 32\nlast: 9\n');truth(r['runtime']['compute']['completed']==3);truth(len(r['runtime']['compute']['slots'])==2);truth(r['runtime']['externalRevision']==6 and r['runtime']['pendingExternal']==0)
  check('managed Task continuations await nested compute workers and establish external history epochs',managed_pool)
  http_source=f'''using System;using System.Net.Http;using System.Text.Json;using System.Threading.Tasks;class P{{static async Task Main(){{using var c=new HttpClient();try{{var text=await c.GetStringAsync("{origin}/data");using var d=JsonDocument.Parse(text);Console.WriteLine(d.RootElement.GetProperty("answer").GetInt32());}}catch(Exception e){{Console.WriteLine("denied");}}}}}}'''
  def deny():
   source(http_source);before=len(requests);r=run();truth(r['output']=='denied\n');truth(len(requests)==before);truth(r['runtime']['network']['requests']==0)
  check('ungranted managed HttpClient makes zero actual requests',deny)
  def allowed():
   stop();configure({'enabled':True,'allowedOrigins':[origin]});r=run();truth(r['output']=='42\n',str(r));truth(requests[-1]['path']=='/data' and requests[-1]['cookie'] is None);truth(r['runtime']['network']['completed']==1 and r['runtime']['pendingExternal']==0)
  check('managed HttpClient fetches a real CORS-enabled loopback endpoint and parses its response',allowed)
  def post():
   source(f'''using System;using System.Net.Http;using System.Threading.Tasks;class P{{static async Task Main(){{using var c=new HttpClient();c.BaseAddress=new Uri("{origin}/");c.DefaultRequestHeaders.Add("x-demo","explicit");var r=await c.PostAsync("echo",new StringContent("hello"));Console.WriteLine(await r.Content.ReadAsStringAsync());Console.WriteLine(r.StatusCode);}}}}''');configure({'enabled':True,'allowedOrigins':[origin]});r=run();truth(r['output']=='hello\n200\n');truth(requests[-1]['body']=='hello' and requests[-1]['header']=='explicit')
  check('relative BaseAddress, POST content, explicit headers and buffered response cross actual HTTP',post)
  def cancel_http():
   source(f'''using System;using System.Net.Http;using System.Threading;using System.Threading.Tasks;class P{{static async Task Main(){{using var c=new HttpClient();using var token=new CancellationTokenSource();var job=c.GetAsync("{origin}/slow",token.Token);await Task.Delay(30);token.Cancel();try{{await job;}}catch(Exception e){{Console.WriteLine("canceled");}}}}}}''');configure({'enabled':True,'allowedOrigins':[origin]});r=run();truth(r['output']=='canceled\n');truth(r['runtime']['pendingExternal']==0)
  check('managed CancellationTokenSource aborts a real pending browser HTTP request',cancel_http)
  def archive():
   r=ev('''async()=>{const {importWorkspaceZip}=await __sharpforgeTestImport('/packages/project-system/src/index.js');return importWorkspaceZip(await sharpforge.exportWorkspaceZip()).settings;}''');truth('runtimeSettings' not in r and 'network' not in r and 'allowedOrigins' not in r);load('simd-vector-math');truth(not ev('sharpforge.getRuntimeSettings().enabled'))
  check('workspace archives and newly loaded samples cannot restore networking grants',archive)
  def panel_validation():
   ev('sharpforge.openTool("runtime-settings")');page.locator('#runtime-network').check();page.locator('#runtime-origins').fill(origin+'/not-an-origin');page.locator('#runtime-apply').click();wait('document.getElementById("runtime-status").textContent.includes("exact")');truth(not ev('sharpforge.getRuntimeSettings().enabled'));page.locator('#runtime-origins').fill(origin);page.locator('#runtime-apply').click();wait('sharpforge.getRuntimeSettings().enabled');page.locator('#runtime-revoke').click();wait('!sharpforge.getRuntimeSettings().enabled');truth(ev('sharpforge.getRuntimeSettings().allowedOrigins').__len__()==0)
  check('runtime panel rejects path grants; explicit apply and revoke update real launch settings',panel_validation)
  def ui_compute():
   load('winui-compute-monitor');ev('sharpforge.execute("winuiLayout");sharpforge.run()');wait('sharpforge.getState().debug?.uiActive');ev('sharpforge.uiSettled()');ev('async()=>{const s=await sharpforge.getUIScene();await sharpforge.dispatchUIEvent(s.nodes.find(n=>n.properties.Name==="ComputeButton").id,"Click",{});}');wait('async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Completed: sum = 5000.0")');r=ev('sharpforge.getRuntimeInfo()');truth(r['compute']['completed']==1,str(r));truth(r['pendingExternal']==0);page.wait_for_timeout(6200);page.screenshot(path=str(ROOT/'docs/screenshots/release14-compute-ui.png'));stop()
  check('code-first WinUI async handler awaits real compute worker and updates the existing controls',ui_compute)
  def snapshot_barrier():
   r=ev('''async()=>{const {compileToIL}=await __sharpforgeTestImport('/packages/compiler/src/index.js');const {VirtualMachine}=await __sharpforgeTestImport('/packages/runtime/src/index.js');const c=compileToIL('using System.Threading.Tasks;using SharpForge.Runtime;class P{static async Task Main(){Console.WriteLine(await ParallelMath.SumAsync(new double[]{42.0}));}}');const vm=new VirtualMachine(c.image);try{const before=vm.snapshot();await vm.runAsync();try{vm.restore(before);return {error:null}}catch(e){return {error:e.message,output:vm.output.join("")}}}finally{vm.stop();}}''');truth(r['error'] and 'external' in r['error'].lower(),str(r));truth(r['output']=='42\n')
  check('pre-external managed snapshots cannot be restored after a completed host operation',snapshot_barrier)
  def screenshot():
   load('parallel-compute');run();ev('sharpforge.openTool("runtime-settings")');page.wait_for_timeout(6200);page.screenshot(path=str(ROOT/'docs/screenshots/release14-runtime.png'));truth(page.locator('#runtime-metrics').inner_text().find('isolated')>=0 or 'spawned' in page.locator('#runtime-metrics').inner_text());truth(not errors,str(errors))
  check('runtime inspector shows actual backend and job metrics without page errors',screenshot)
  report={'passed':True,'checks':checks,'pageErrors':errors,'workerEvents':len(workers),'httpRequests':requests,'mode':'Production modules + real workers via in-memory HTML; actual browser Fetch to CORS-enabled local HTTP server; no fetch or compute test doubles'}
  (ROOT/'docs/browser-release14-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':True,'checks':len(checks),'workerEvents':len(workers),'httpRequests':len(requests)},indent=2))
 except Exception:
  page.screenshot(path=str(ROOT/'docs/screenshots/release14-failure.png'));print(json.dumps({'errors':errors,'state':state()},default=str)[-12000:],flush=True);traceback.print_exc();raise
 finally:
  b.close();server.shutdown();server.server_close()
