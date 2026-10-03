"""Functional browser acceptance tests. No compiler/runtime mocks.
Use SHARPFORGE_IN_MEMORY=1 only on restricted runners; default is normal HTTP.
"""
import json,os,subprocess,time,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
RESULTS = results_dir()
from browser_harness import load_application
ROOT=Path(__file__).resolve().parents[1]
REPORT=RESULTS/'browser-results.json'
SHOTS=RESULTS/'screenshots'
SHOTS.mkdir(parents=True,exist_ok=True)
checks=[]
def checked(name, action):
    start=time.perf_counter()
    action()
    checks.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)})
    print('PASS',name,flush=True)
def truth(value,message='assertion failed'):
    if not value: raise AssertionError(message)
server=None
mode='in-memory' if os.getenv('SHARPFORGE_IN_MEMORY')=='1' else 'http'
try:
 with sync_playwright() as p, launch_browser(p, __file__) as browser:
    page=browser.new_page(viewport={'width':1536,'height':960},device_scale_factor=1)
    errors=[]; workers=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
    page.on('worker',lambda w:workers.append(w.url))
    load_application(page)
    state=lambda:page.evaluate('window.sharpforge.getState()')
    wait=lambda expr:page.wait_for_function(expr,timeout=15000)
    command=lambda cmd:page.evaluate('(cmd)=>window.sharpforge.execute(cmd)',cmd)
    checked('two dedicated browser workers initialized',lambda:truth(len(workers)==2,str(workers)))
    checked('initial multi-file compile has no diagnostics',lambda:truth(len([d for d in state()['diagnostics'] if d['severity']=='error'])==0 and state()['metrics']['files']==2))
    def il_artifact():
        truth(state()['artifact']['format']=='ECMA-335')
        truth(page.evaluate('Array.from(window.sharpforge.getAssembly().slice(0,2))')==[77,90])
    checked('default build emits real PE/CLI DLL bytes',il_artifact)
    def run_particles():
        command('run');wait("window.sharpforge.getState().debug?.state === 'terminated'")
        truth('Tick 3 → energy: 276' in state()['debug']['output'],state()['debug']['output'])
    checked('run multi-file particle program with actual output',run_particles)
    def cold_il_load():
        truth(state()['debug']['stats']['artifactFormat']=='ECMA-335')
        truth(state()['debug']['assemblyLoad']['cacheHit'] is False)
    checked('runtime worker loads IL rather than compiler IR',cold_il_load)
    def pause_and_breakpoint():
        page.click('#start');wait("window.sharpforge.getState().debug?.state === 'paused'")
        truth(state()['debug']['reason']['reason']=='breakpoint')
        truth(state()['debug']['point']['line']==27)
        truth(page.evaluate("window.sharpforge.evaluate('particles.Length')")['value']==3)
    checked('F5 runs directly to bound source breakpoint without forced entry',pause_and_breakpoint)
    def cached_il_debug():
        truth(state()['debug']['assemblyLoad']['cacheHit'] is True)
        truth(state()['debug']['frames'][0]['ilOffset']==state()['debug']['point']['ilOffset'])
        truth(state()['debug']['frames'][0]['methodToken']>=0x06000001)
    checked('debugger reuses decoded IL and reports real IL offsets',cached_il_debug)
    page.wait_for_timeout(150)
    page.screenshot(path=str(SHOTS/'studio-debug.png'))
    def step_into_out():
        page.click('#step-in');wait("window.sharpforge.getState().debug?.point?.line === 8")
        truth(len(state()['debug']['frames'])==2)
        truth(page.evaluate("window.sharpforge.evaluate('step')")['value']==0)
        page.click('#step-out');wait("window.sharpforge.getState().debug?.point?.line !== 8")
        truth(len(state()['debug']['frames'])==1)
    checked('toolbar step into/out traverses real call frames',step_into_out)
    def back():
        before=state()['debug']['stats']['instructions'];page.click('#step-back')
        wait(f"window.sharpforge.getState().debug.stats.instructions < {before}")
    checked('step back restores earlier managed snapshot',back)
    def inspect():
        command('heap');truth(page.locator('[data-tool=heap]').is_visible())
        truth(page.locator('[data-tool=heap] .data-table tbody tr').count()>0)
    checked('managed heap inspector shows actual allocations',inspect)
    def panels():
        for panel in ['output','problems','debug','stack','breakpoints','bytecode']:
            page.click(f'[data-dock-tab="{panel}"]');truth(state()['panel']==panel)
        truth(page.locator('[data-tool=bytecode]').inner_text().find('IL_')>=0)
    checked('all six tool panels render, including disassembly',panels)
    def il_disassembly():
        truth(page.locator('#bytecode-format').input_value()=='cil')
        truth('IL_' in page.locator('[data-tool=bytecode]').inner_text())
        page.select_option('#bytecode-format','ir')
        truth('SEQ' in page.locator('[data-tool=bytecode]').inner_text())
        page.select_option('#bytecode-format','cil')
        truth('IL_' in page.locator('[data-tool=bytecode]').inner_text())
    checked('actual CIL and decoded IR disassembly toggle',il_disassembly)
    command('stop');wait("window.sharpforge.getState().debug?.state === 'terminated'")
    def diagnostics():
        page.locator('.sf-input:visible').first.fill('int x = "bad";\nConsole.WriteLine(x);')
        wait("window.sharpforge.getState().diagnostics.some(d=>d.code==='CS0029')")
        truth(page.locator('#error-count').inner_text()!='0')
        page.locator('.sf-input:visible').first.fill('int x=42;\nConsole.WriteLine(x);')
        wait("!window.sharpforge.getState().diagnostics.some(d=>d.severity==='error')")
        command('run');wait("window.sharpforge.getState().debug?.state==='terminated'")
        truth(state()['debug']['output']=='42\n')
    checked('editing refreshes diagnostics and recompiles repaired program',diagnostics)
    def autocomplete():
        page.locator('.sf-input:visible').first.fill('Console.')
        page.locator('.sf-input:visible').first.press('Control+Space')
        page.wait_for_selector('.sf-completions:not(.hidden)')
        truth('WriteLine' in page.locator('.sf-completions:visible').inner_text())
        page.locator('.sf-input:visible').first.press('Escape')
    checked('member completion on incomplete source',autocomplete)
    def undo_redo():
        box=page.locator('.sf-input:visible').first;box.fill('int sample=1;');box.press('End');box.press('x');truth(box.input_value().endswith('x'))
        box.press('Control+z');truth(not box.input_value().endswith('x'))
        box.press('Control+Shift+z');truth(box.input_value().endswith('x'))
    checked('editor undo/redo preserves input changes',undo_redo)
    for sample,expected in [('gc','Collections:'),('recursion','fib(9) = 34'),('exceptions','Execution recovered safely.'),('arrays','3\n7\n11\n19\n28\n42\n')]:
        def sample_run(sample=sample,expected=expected):
            page.evaluate('(id)=>window.sharpforge.loadSample(id,true)',sample)
            command('run');wait("window.sharpforge.getState().debug?.state==='terminated'")
            truth(expected in state()['debug']['output'],state()['debug']['output'])
        checked('browser sample: '+sample,sample_run)
    def source_errors():
        page.evaluate("window.sharpforge.loadSample('errors',true)")
        truth(len(state()['diagnostics'])>=3)
        command('build');truth(state()['panel']=='problems')
    checked('error sample blocks IL emission',source_errors)
    page.evaluate("window.sharpforge.loadSample('particles',true)")
    def export_assembly():
        page.evaluate("window.sharpforge.loadSample('arrays',true)")
        with page.expect_download() as event:
            command('assemblyExport')
        downloaded=event.value
        truth(downloaded.suggested_filename.endswith('.dll'))
        destination=RESULTS/'browser-export.dll'
        downloaded.save_as(str(destination))
        truth(destination.read_bytes()[:2]==b'MZ')
    checked('File command downloads a real IL assembly',export_assembly)
    def import_assembly():
        command('stop')
        data=page.evaluate('Array.from(window.sharpforge.getAssembly())')
        page.evaluate('(data)=>window.sharpforge.importAssembly(new Uint8Array(data))',data)
        truth(state()['artifact']['imported'] is True)
        command('run');wait("window.sharpforge.getState().debug?.state==='terminated'")
        truth(state()['debug']['output']=='3\n7\n11\n19\n28\n42\n')
        truth(state()['artifact']['imported'] is True)
    checked('imported DLL executes directly without rebuilding source',import_assembly)
    def source_free_assembly():
        command('stop')
        produced=subprocess.run(['node','--input-type=module','-e',
            'import {compileToIL} from "./packages/compiler/src/index.js"; console.log(JSON.stringify(Array.from(compileToIL("Console.WriteLine(123);",{embedSources:false}).assembly)))'],
            cwd=ROOT,check=True,text=True,capture_output=True, encoding='utf-8')
        data=json.loads(produced.stdout)
        page.evaluate('(data)=>window.sharpforge.importAssembly(new Uint8Array(data))',data)
        truth('Console.WriteLine' not in state()['files'][0]['text'])
        command('run');wait("window.sharpforge.getState().debug?.state==='terminated'")
        truth(state()['debug']['output']=='123\n')
        truth(state()['artifact']['imported'] is True)
        page.evaluate("window.sharpforge.loadSample('particles',true)")
    checked('source-free DLL executes without source recompilation',source_free_assembly)
    def theme():
        command('theme');truth(page.locator('html').get_attribute('data-theme')=='light')
        page.screenshot(path=str(SHOTS/'studio-light.png'))
        command('theme');truth(page.locator('html').get_attribute('data-theme')=='dark')
    checked('dark and light themes',theme)
    def resize():
        command('tool:solution')
        handle=page.locator('[data-split-id=split-left] > .sf-dock-divider').bounding_box();before=page.locator('#solution').bounding_box()['width']
        delta=-40 if page.locator('#solution').bounding_box()['x']>handle['x'] else 40
        page.mouse.move(handle['x']+2,handle['y']+100);page.mouse.down();page.mouse.move(handle['x']+2+delta,handle['y']+100);page.mouse.up()
        truth(page.locator('#solution').bounding_box()['width']>before)
    checked('resizable tool windows',resize)
    def mobile():
        page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
        truth(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        truth(page.locator('.sf-input:visible').first.is_visible())
        command('toggleExplorer');truth(page.locator('#solution').is_visible());command('toggleExplorer')
        command('toggleTools');truth(page.locator('#diagnostic-tools').is_visible());command('toggleTools')
        page.screenshot(path=str(SHOTS/'studio-mobile.png'))
    checked('390px responsive layout and tool overlays',mobile)
    def tablet():
        page.set_viewport_size({'width':850,'height':1000});command('tool:diagnostics');truth(page.locator('#diagnostic-tools').is_visible());command('toggleTools');truth(not page.locator('#diagnostic-tools').is_visible())
    checked('tablet diagnostic tools overlay',tablet)
    page.set_viewport_size({'width':1536,'height':960})
    def docs():
        for c in ['architecture','profile','shortcuts','about']:
            command(c);truth(page.locator('#modal-backdrop').is_visible());page.click('#modal-close')
    checked('documentation and keyboard help dialogs',docs)
    checked('no browser JavaScript errors',lambda:truth(not errors,str(errors)))
    REPORT.write_text(json.dumps({'browser':browser.version,'mode':mode,'workers':'real dedicated classic workers, statically bundled from production ESM','storage':'harness-only in-memory shim' if mode=='in-memory' else 'native browser storage','network':'not validated in in-memory mode' if mode=='in-memory' else 'HTTP static server','tests':checks,'total':len(checks),'passed':len(checks)},indent=2), encoding='utf-8')
finally:
    if server:server.terminate()
