"""Smoke-test the single-file release with actual compiler/runtime workers.

The HTML is injected into about:blank: this deliberately does not test file-URL
policy, HTTP navigation, or native persistent storage. No network is required.
"""
import json
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_harness import wait_condition

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    executable = os.getenv('CHROMIUM_EXECUTABLE')
    browser = p.chromium.launch(
        **({'executable_path': executable} if executable else {}),
        headless=True, args=['--no-sandbox'])
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, workers = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text)
                if message.type == 'error' else None)
        page.on('worker', lambda worker: workers.append(worker.url))
        page.on('dialog', lambda dialog: dialog.accept())
        page.set_content((ROOT / 'SharpForge-standalone.html').read_text())
        page.wait_for_function(
            'window.sharpforge && window.sharpforge.getState().metrics !== null',
            timeout=15000)
        state = page.evaluate('window.sharpforge.getState()')
        assert len(workers) == 2, workers
        assert state['metrics']['files'] == 2, state['metrics']
        assert not [d for d in state['diagnostics'] if d['severity']=='error'], state['diagnostics']
        assert state['artifact']['format'] == 'ECMA-335'
        assert page.evaluate('Array.from(window.sharpforge.getAssembly().slice(0,2))') == [77,90]
        page.evaluate('window.sharpforge.run()')
        page.wait_for_function(
            "window.sharpforge.getState().debug?.state === 'terminated'",
            timeout=15000)
        output = page.evaluate('window.sharpforge.getState().debug.output')
        assert 'Tick 3 → energy: 276' in output, output
        assert 'Simulation complete.' in output, output
        assert page.evaluate('window.sharpforge.getState().debug.stats.artifactFormat') == 'ECMA-335'
        page.evaluate('window.sharpforge.debug()')
        page.wait_for_function(
            "window.sharpforge.getState().debug?.state === 'paused'",
            timeout=15000)
        assert page.evaluate('window.sharpforge.getState().debug.point.line') == 27
        print("STANDALONE workflow 49", flush=True)
        page.evaluate('sharpforge.execute("stop")')
        fixtures = json.loads(subprocess.check_output([
            'node', '--input-type=module', '-e',
            "import {arithmeticLibrary} from './tests/managed-fixtures.js';import {formatILDocument} from '@sharpforge/cil';const bytes=arithmeticLibrary();console.log(JSON.stringify({bytes:[...bytes],text:formatILDocument(bytes).replace(': add',': mul')}));"
        ], cwd=ROOT, text=True))
        before = page.evaluate('sharpforge.getState().files')
        summary = page.evaluate('bytes=>sharpforge.inspectAssembly(new Uint8Array(bytes))', fixtures['bytes'])
        assert summary['name'] == 'Arithmetic', summary
        assert page.evaluate('sharpforge.getState().files') == before
        page.evaluate('async text=>{const artifact=await sharpforge.assembleIL(text);await sharpforge.invokeAssembly(artifact.bytes,0x06000001,[6,8]);}', fixtures['text'])
        page.wait_for_function('sharpforge.getState().debug?.state === "terminated" && sharpforge.getState().debug.returnValue === "48"')
        assert page.evaluate('sharpforge.getState().debug.stats.profile') == 'SharpForge.ManagedIL/1'
        print("STANDALONE workflow 61", flush=True)
        page.evaluate('sharpforge.execute("stop")')
        page.evaluate('sharpforge.openFile("Program.cs")')
        page.locator('[data-source-uri="Program.cs"] .sf-input').fill('Console.WriteLine(GeneratedBuildInfo.Version());')
        generated = page.evaluate('sharpforge.configureExtensions({buildInfo:true,version:"standalone-0.4"})')
        assert generated['success'], generated
        assert len(page.evaluate('sharpforge.getGeneratedSources()')) == 1
        page.evaluate('sharpforge.run()')
        page.wait_for_function('sharpforge.getState().debug?.state === "terminated" && sharpforge.getState().debug.output.includes("standalone-0.4")')
        # New project/docking modules must also work in the self-contained build.
        print("STANDALONE workflow 70", flush=True)
        page.evaluate('sharpforge.execute("stop")')
        page.locator('#directory-input').set_input_files(str(ROOT / 'examples/projects/Workshop'))
        page.wait_for_function('sharpforge.getState().project?.projects.length===2 && sharpforge.getState().artifact!==null')
        page.evaluate('sharpforge.run()')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output==="42\\n"')
        source_uris = [f['uri'] for f in page.evaluate('sharpforge.getState().files')]
        first, second = source_uris[0], source_uris[1]
        page.evaluate('(uri)=>sharpforge.openFile(uri)', first)
        page.evaluate('(uri)=>sharpforge.dockPanel("source:"+uri,"documents","right")', second)
        assert page.locator(f'[data-source-uri="{first}"] .sf-input').is_visible()
        assert page.locator(f'[data-source-uri="{second}"] .sf-input').is_visible()
        page.evaluate('sharpforge.floatPanel("output")')
        assert page.locator('.sf-dock-floating').count() == 1
        page.evaluate('sharpforge.dockPanel("output","tools-bottom","center")')
        page.locator('#directory-input').set_input_files(str(ROOT / 'examples/projects/Library'))
        page.wait_for_function('sharpforge.getState().startupProject?.endsWith("Library.csproj") && sharpforge.getState().artifact!==null')
        page.evaluate('sharpforge.run()')
        page.locator('[data-il-method]').filter(has=page.locator('b', has_text='Add')).click()
        page.locator('#assembly-arguments').fill('[2,3]')
        page.locator('[data-il-action=invoke]').click()
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.returnValue==="45"')
        # 0.5 source and raw-IL execution/debugging must survive static bundling.
        print("STANDALONE workflow 92", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("finally",true)')
        page.wait_for_function('sharpforge.getState().artifact!==null')
        page.evaluate('sharpforge.run()')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output.includes("outer cleanup")')
        page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/Arithmetic.dll'))
        page.locator('#assembly-arguments').fill('[20,22]')
        page.locator('[data-il-action="debug"]').click()
        page.wait_for_function('sharpforge.getState().debug?.profile==="managed-il" && sharpforge.getState().debug.state==="paused"')
        page.wait_for_selector('[data-tool="disassembly"] [data-instruction]')
        assert page.locator('[data-tool="disassembly"] [data-instruction]').count()==4
        page.evaluate('sharpforge.step("stepIn")')
        page.wait_for_function('sharpforge.getState().debug.frames[0]?.ilOffset===1')
        page.evaluate('sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.returnValue==="42"')
        page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/PrimitiveAddresses.exe'))
        page.locator('[data-il-action="invoke"]').click()
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.returnValue==="52"')
        # 0.6 paths must survive single-file dependency/worker bundling.
        for sample, expected in [('checked-arithmetic','addition overflow\nmultiplication overflow\n-2147483648\nconversion overflow\n'),('using-resources','acquire outer\nacquire inner\nbody\ndispose inner\ndispose outer\n42\n'),('immutable-schema','42\nsensor\n')]:
            page.evaluate('(id)=>sharpforge.loadSample(id,true)',sample)
            page.wait_for_function('sharpforge.getState().artifact!==null')
            page.evaluate('sharpforge.run()')
            page.wait_for_function('(expected)=>sharpforge.getState().debug?.state==="terminated" && sharpforge.getState().debug.output===expected',arg=expected)
        page.locator('#assembly-file-input').set_input_files(str(ROOT/'examples/managed/StorageWrites.exe'))
        page.locator('[data-il-action="debug"]').click()
        page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        page.evaluate('sharpforge.breakOnWrite({name:"V_1"})')
        page.wait_for_function('sharpforge.getState().debug.dataBreakpoints.length===1')
        page.evaluate('sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug.reason?.reason==="data breakpoint"')
        assert page.evaluate('sharpforge.evaluate("V_1")')['result']=='40'
        page.evaluate('sharpforge.step("stepBack")')
        page.wait_for_function('sharpforge.getState().debug.reason?.reason==="step"')
        assert page.evaluate('sharpforge.evaluate("V_1")')['result']=='0'
        # The new browser-safe native client and tools must not require Node or a connection.
        print("STANDALONE workflow 127", flush=True)
        page.evaluate('async()=>{await sharpforge.execute("stop");sharpforge.openTool("msbuild");}')
        page.wait_for_selector('[data-tool="msbuild"] .native-command')
        assert 'local host' in page.locator('[data-tool="msbuild"]').inner_text()
        assert page.evaluate('sharpforge.native.getState().connected') is False
        page.evaluate('sharpforge.openTool("project-source");sharpforge.openTool("msbuild-inspector");sharpforge.execute("nativeBuildLayout")')
        assert page.locator('[data-tool="project-source"]').count() == 1
        assert page.locator('[data-tool="msbuild-inspector"]').count() == 1
        # 0.8 controls and vendor editor factory must be bundled, not downloaded.
        print("STANDALONE workflow 135", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.execute("resetLayout");sharpforge.loadSample("explorer-members",true)')
        page.wait_for_function('sharpforge.getState().artifact!==null')
        assert page.evaluate('sharpforge.getKeymap().id') == 'visual-studio'
        assert page.locator('#file-tree').get_attribute('role') == 'tree'
        page.evaluate('sharpforge.openFile("Program.cs");sharpforge.setKeymap("vim")')
        cm = page.locator('[data-source-uri="Program.cs"] .CodeMirror');cm.click();page.keyboard.press('Escape');page.keyboard.type('ggI// standalone ');page.keyboard.press('Escape')
        assert page.evaluate('sharpforge.getEditorState("Program.cs").value.startsWith("// standalone ")')
        page.keyboard.type('u');assert not page.evaluate('sharpforge.getEditorState("Program.cs").value.startsWith("// standalone ")')
        cm.click(button='right');assert page.locator('.sf-menu:visible').count() == 1;page.keyboard.press('Escape')
        print("STANDALONE workflow 144", flush=True)
        page.evaluate('sharpforge.setKeymap("visual-studio");sharpforge.loadSample("breakpoint-workbench",true)')
        page.wait_for_function('sharpforge.getState().artifact!==null')
        page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:7,hitCondition:"2"}]);sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug?.reason?.reason==="breakpoint"')
        assert page.evaluate('sharpforge.getState().debug.breakpoints[0].hits') == 2
        page.evaluate('sharpforge.setBreakpoints("Program.cs",[]);sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').endswith('cleanup\n6\n')
        # 0.9 debugger integration runs through the self-contained worker bundles.
        print("STANDALONE workflow 153", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("recursion",true)')
        page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:20}]);sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug?.state==="paused" && sharpforge.getState().debug.breakpoints[0].hits===1')
        assert page.evaluate('sharpforge.getState().debug.point.line') == 20
        assert page.evaluate('sharpforge.getState().debug.output') == ''
        assert page.evaluate('sharpforge.getEditorState("Program.cs").executionLine') == 20
        assert page.evaluate('sharpforge.immediate("i+42")')['result'] == '42'
        page.evaluate('Promise.all([sharpforge.debug(),sharpforge.debug()])')
        page.wait_for_function('sharpforge.getState().debug?.state==="paused" && sharpforge.getState().debug.breakpoints[0].hits===2')
        page.evaluate('sharpforge.execute("reverseContinue")')
        assert page.evaluate('sharpforge.getState().debug.breakpoints[0].hits') == 1
        assert page.evaluate('sharpforge.evaluate("i")')['result'] == '0'
        print("STANDALONE workflow 165", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("debug-function",true)')
        page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.reason?.reason==="function breakpoint"')
        assert page.evaluate('sharpforge.evaluate("value")')['result'] == '2'
        print("STANDALONE workflow 168", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("debug-callsite",true)')
        page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        page.evaluate('sharpforge.breakOnWrite({frameId:sharpforge.getState().debug.frames[0].id,name:"value"})')
        page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.reason?.reason==="data breakpoint"')
        assert page.evaluate('sharpforge.getState().debug.point.uri') == 'Program.cs'
        assert page.evaluate('sharpforge.getState().debug.point.line') == 6
        assert page.evaluate('sharpforge.evaluate("value")')['result'] == '42'
        assert page.evaluate('sharpforge.getEditorState("Program.cs").executionLine') == 6
        # New managed debugger/runtime/UI APIs must also work without module network loads.
        print("STANDALONE workflow 177", flush=True)
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("portable-symbols",true)')
        assert page.evaluate('sharpforge.getPdb().length') > 100
        page.evaluate('sharpforge.openTool("symbols")');page.locator('[data-inspect]').click()
        page.wait_for_function('document.querySelector(".symbol-id").textContent.includes("PDB ")')
        assert page.locator('[data-symbol-document]').count() == 2
        print("STANDALONE workflow 182", flush=True)
        page.evaluate('async()=>{await sharpforge.loadSample("set-next",true);await sharpforge.debug();}')
        page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        page.evaluate('async()=>{await sharpforge.setNextStatement({uri:"Program.cs",line:4});await sharpforge.debug();}')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip() == '1'
        print("STANDALONE workflow 187", flush=True)
        page.evaluate('async()=>{await sharpforge.execute("stop");await sharpforge.loadSample("function-evaluation",true);await sharpforge.debug();}')
        page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        page.evaluate('sharpforge.evaluateFunction("ledger.Add(2)",{allowSideEffects:true,commit:false})')
        assert page.evaluate('sharpforge.evaluate("ledger.Value")')['result'] == '40'
        page.evaluate('sharpforge.evaluateFunction("ledger.Add(2)",{allowSideEffects:true})')
        assert page.evaluate('sharpforge.evaluate("ledger.Value")')['result'] == '42'
        print("STANDALONE workflow 193", flush=True)
        page.evaluate('async()=>{await sharpforge.execute("stop");await sharpforge.loadSample("hot-reload",true);await sharpforge.debug();}')
        page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        page.evaluate('sharpforge.beginHotReload();sharpforge.openFile("Program.cs")')
        area=page.locator('[data-source-uri="Program.cs"] .sf-input')
        area.fill(area.input_value().replace('x + 1','x + 2'))
        page.evaluate('sharpforge.applyHotReload();')
        assert page.evaluate('sharpforge.getState().debug.codeVersion') == 1
        page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip() == '43'
        print("STANDALONE workflow 202", flush=True)
        page.evaluate('async()=>{await sharpforge.execute("stop");await sharpforge.loadSample("winui-counter",true);await sharpforge.setBreakpoints("Program.cs",[]);await sharpforge.execute("winuiLayout");await sharpforge.run();}')
        page.wait_for_function('sharpforge.getState().debug?.uiActive');page.evaluate('sharpforge.uiSettled()')
        page.locator('.sf-winui button').filter(has_text='Increment').click()
        page.wait_for_function('document.querySelector(".sf-winui").textContent.includes("Count: 1")')
        print("STANDALONE workflow 206", flush=True)
        page.evaluate('async()=>{await sharpforge.execute("stop");await sharpforge.loadSample("winui-async",true);await sharpforge.setBreakpoints("Program.cs",[]);await sharpforge.execute("winuiLayout");await sharpforge.run();}')
        page.wait_for_function('sharpforge.getState().debug?.uiActive');page.evaluate('sharpforge.uiSettled()')
        page.locator('.sf-winui button').first.click()
        page.wait_for_function('sharpforge.getState().debug?.state==="waiting"')
        threads=page.evaluate('sharpforge.getParallelStacks()')
        assert any(t.get('waitingFor') for t in threads['contexts'])
        page.wait_for_function('document.querySelector(".sf-winui").textContent.includes("Answer: 42")')
        # 0.11 template and archive packages also execute from the offline bundle.
        page.evaluate('sharpforge.execute("stop")');page.evaluate('void sharpforge.openProjectWizard()')
        page.locator('[data-template="console-library-solution"]').click();page.locator('#wizard-next').click()
        page.locator('#wizard-project-name').fill('OfflineWizard');page.locator('#wizard-next').click()
        page.wait_for_function('document.querySelector("#modal-backdrop").classList.contains("hidden")')
        page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip()=='42'
        page.evaluate('sharpforge.execute("stop")')
        archived=page.evaluate('async()=>Array.from(await sharpforge.exportWorkspaceZip())')
        import zipfile,io
        archive=zipfile.ZipFile(io.BytesIO(bytes(archived)));assert archive.testzip() is None
        assert 'OfflineWizard.slnx' in archive.namelist()
        page.evaluate('async bytes=>{await sharpforge.loadSample("arrays",true);return sharpforge.openWorkspaceZip(new File([new Uint8Array(bytes)],"OfflineWizard.zip"));}',archived)
        assert page.evaluate('sharpforge.getState().startupProject')=='OfflineWizard/OfflineWizard.csproj'
        page.evaluate('void sharpforge.openItemWizard({kind:"project",path:"OfflineWizard.Core/OfflineWizard.Core.csproj",project:"OfflineWizard.Core/OfflineWizard.Core.csproj"})')
        page.locator('[data-template="partial-class"]').click();page.locator('#wizard-next').click();page.locator('#wizard-item-name').fill('OfflineModel.cs');page.locator('#wizard-next').click()
        page.wait_for_function('document.querySelector("#modal-backdrop").classList.contains("hidden")')
        assert page.evaluate('sharpforge.getWorkspace().records.some(r=>r.path.endsWith("OfflineModel.Methods.cs"))')
        # 0.12 designer and structural EnC execute from the single-file bundle.
        page.evaluate('sharpforge.execute("stop");sharpforge.designer.open();sharpforge.designer.action("new");sharpforge.designer.select("action");sharpforge.designer.set("Content","Offline design");')
        assert page.locator('.design-preview [data-sf-id="action"]').inner_text()=='Offline design'
        page.evaluate('sharpforge.designer.undo()')
        assert page.locator('.design-preview [data-sf-id="action"]').inner_text()=='Run action'
        page.evaluate('sharpforge.designer.style("Accent",{targetType:"Button",setters:{FontSize:26}});sharpforge.designer.template("OfflineTemplate",{targetType:"Button",root:{id:"content",type:"ContentPresenter",properties:{},bindings:{Content:"Content"},children:[]}});sharpforge.designer.reference("template","OfflineTemplate",["action"]);')
        assert page.locator('.design-preview [data-sf-id="action::content"]').count()==1
        assert page.evaluate('sharpforge.designer.get().document.styles.Accent.setters.FontSize')==26
        page.evaluate('sharpforge.designer.action("save")')
        designer_zip=page.evaluate('async()=>Array.from(await sharpforge.exportWorkspaceZip())')
        saved=zipfile.ZipFile(io.BytesIO(bytes(designer_zip)))
        assert any(name.endswith('.sfdesign.json') for name in saved.namelist())
        page.evaluate('sharpforge.designer.action("generate")')
        page.wait_for_function('sharpforge.getState().debug?.uiActive')
        current=page.evaluate('sharpforge.getUIScene()')
        button=next(n for n in current['nodes'] if n['properties'].get('Name')=='ActionButton')
        page.evaluate('id=>sharpforge.dispatchUIEvent(id,"Click",{})',button['id'])
        page.wait_for_function('sharpforge.getState().debug.output.includes("OnAction invoked")')
        page.evaluate('sharpforge.designer.attach()')
        live=page.evaluate('sharpforge.designer.get()')
        target=next(n['id'] for n in live['document']['nodes'] if n['properties'].get('Name')=='ActionButton')
        page.evaluate('id=>{sharpforge.designer.set("Width",242,[id]);return sharpforge.designer.apply();}',target)
        current=page.evaluate('sharpforge.getUIScene()')
        after=next(n for n in current['nodes'] if n['properties'].get('Name')=='ActionButton')
        assert after['id']==button['id'] and after['properties']['Width']==242
        page.evaluate('id=>sharpforge.dispatchUIEvent(id,"Click",{})',button['id'])
        page.wait_for_function('sharpforge.getState().debug.output.split("OnAction invoked").length===3')
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("edit-continue-structure",true);')
        page.evaluate('sharpforge.debug()');page.wait_for_function('sharpforge.getState().debug?.state==="paused"')
        before_value=page.evaluate('sharpforge.evaluate("value")')
        page.evaluate('sharpforge.beginHotReload();sharpforge.openFile("Program.cs")')
        area=page.locator('[data-source-uri="Program.cs"] .sf-input')
        code=area.input_value().replace('return value + 2;', 'return Added(value);').replace('static void Main()', 'static int Added(int value) { return value + 10; } static void Main()')
        area.fill(code);page.evaluate('sharpforge.applyHotReload()')
        assert page.evaluate('sharpforge.getState().debug.codeVersion')==1
        assert page.evaluate('sharpforge.evaluate("value")')['result']==before_value['result']
        page.evaluate('sharpforge.setBreakpoints("Program.cs",[])');page.evaluate('sharpforge.debug()')
        page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip()=='51'
        # 0.13: real editor synchronization and BCL/animation from the offline bundle.
        page.evaluate('sharpforge.execute("stop");sharpforge.designer.disconnect();')
        page.evaluate('sharpforge.loadSample("designer-csharp-sync",true)')
        page.evaluate('sharpforge.designer.open();sharpforge.designer.connect("Program.cs");sharpforge.designer.setAutoSync(true);sharpforge.designer.select("action");sharpforge.designer.set("Width",276,["action"])')
        wait_condition(page,'sharpforge.designer.get().sourceSync.state==="synced"',timeout=30000)
        original=page.evaluate('sharpforge.getState().files.find(f=>f.uri==="Program.cs").text')
        assert 'Width = 276' in original and 'static void OnAction(' in original
        page.evaluate('sharpforge.openFile("Program.cs")')
        page.locator('[data-source-uri="Program.cs"] .sf-input').fill(original.replace('Code and design, together.','Standalone sync works.'))
        wait_condition(page,'sharpforge.designer.get().document.nodes.some(n=>n.properties.Text==="Standalone sync works.")',timeout=30000)
        assert page.evaluate('sharpforge.designer.get().sourceSync.state')=='synced'
        assert page.locator('.design-property-category').count() >= 4
        assert page.locator('.design-mode-bar').evaluate('e=>getComputedStyle(e).display')=='flex'
        page.evaluate('sharpforge.designer.disconnect()');page.evaluate('sharpforge.loadSample("bcl-collections",true)')
        page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip()=='1,2,3\n3\nfirst\n2'
        page.evaluate('sharpforge.execute("stop")');page.evaluate('sharpforge.loadSample("csharp-interpolation",true)')
        page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output').strip()=='{  007} 2.50 002A\npath\\item8'
        page.evaluate('sharpforge.execute("stop")');page.evaluate('sharpforge.loadSample("winui-storyboards",true)')
        page.evaluate('sharpforge.execute("winuiLayout")');page.evaluate('sharpforge.run()');page.wait_for_function('sharpforge.getState().debug?.uiActive')
        page.evaluate('sharpforge.setUIAnimationMode(true)');page.evaluate('sharpforge.uiSettled()')
        page.locator('.sf-winui button').filter(has_text='Play').click()
        wait_condition(page,'async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Playing")',timeout=30000)
        page.evaluate('sharpforge.advanceUIAnimations(4000)')
        wait_condition(page,'async()=> (await sharpforge.getUIScene()).nodes.some(n=>n.properties.Text==="Complete — play again")',timeout=30000)
        page.evaluate('sharpforge.execute("stop")')
        # 0.14: the single file includes language profiles, WASM bytes and nested worker code.
        page.evaluate('sharpforge.loadSample("csharp-preview-collections",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output')=='1,2,3,4\n22\n'
        assert page.evaluate('sharpforge.getRuntimeSettings().langVersion')=='preview'
        page.evaluate('sharpforge.loadSample("csharp-modern-properties",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output')=='42\n0\n'
        page.evaluate('sharpforge.loadSample("bcl-json-document",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output')=='items: 3\nTotal: 42\n{"total":42}\n'
        page.evaluate('sharpforge.loadSample("simd-vector-math",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.runtime.simd.backend')=='wasm-simd128'
        assert page.evaluate('sharpforge.getState().debug.output')=='20\n32\n14\n'
        page.evaluate('sharpforge.loadSample("parallel-compute",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.output')=='sum: 6\ndot: 32\nlast: 9\n'
        assert page.evaluate('sharpforge.getState().debug.runtime.compute.completed')==3
        assert page.evaluate('sharpforge.getState().debug.runtime.externalRevision')==6
        page.evaluate('sharpforge.loadSample("network-http-client",true)')
        page.evaluate('sharpforge.run()');wait_condition(page,'sharpforge.getState().debug?.state==="terminated"')
        assert page.evaluate('sharpforge.getState().debug.runtime.network.requests')==0
        assert page.evaluate('sharpforge.getState().debug.output').startswith('Request blocked')
        page.evaluate('sharpforge.openTool("runtime-settings")')
        assert page.locator('#runtime-network').count()==1
        assert not page.locator('#runtime-network').is_checked()
        assert page.locator('#runtime-language').input_value()=='14'
        page.evaluate('sharpforge.execute("stop")')
        assert not errors, errors
        report = {
            'passed': True,
            'packaging': 'Single self-contained HTML; real compiler and runtime Blob workers',
            'browser': browser.version,
            'workers': len(workers),
            'checks': ['two dedicated workers', 'initial multi-file compilation', 'real PE/CLI output and IL worker execution',
                       'simulation completes with expected output',
                       'F5 stops at requested source breakpoint 27 without entry stop', 'ordinary DLL inspection preserves source',
                       'editable IL rebuild executes multiply and returns 48',
                       'generator output compiles and executes in standalone workers',
                       'directory input SLNX/project-reference source build returns 42',
                       'independent split document editors', 'floating tool and redock',
                       'library project with static initializer invoked without Main returns 45', 'nested finally in standalone source compilation','raw DLL instruction debugger and docked bytes','single-instruction step and continue without stale source build','primitive address and sizeof EXE invocation','checked int32 overflow in bundled workers','using cleanup in bundled workers','immutable schema generation and invocation','raw-IL managed write breakpoint and reverse local restoration','native build controls load without Node or an implicit connection','native layout retains project source and evaluation tools','tree and default Visual Studio profile bundled','Vim edit and undo use the same source buffer offline','shared code context menu bundled','source hit-count breakpoint removal continues to cleanup','exact Fibonacci F5 stop at requested line 20', 'safe Immediate selected-frame evaluation', 'duplicate Continue commands coalesce', 'source reverse stop restores Fibonacci value and hits', 'signature/condition function breakpoint in bundled example', 'source write breakpoint stops at caller store after return', 'standalone PDB emission and verified embedded source', 'guarded Set Next Statement preserves locals', 'managed evaluation preview rollback and committed invocation', 'Hot Reload preserves locals and executes changed code', 'code-first WinUI renders and dispatches a managed Button.Click', 'async UI handler exposes await stacks then resumes to result', 'offline project wizard creates a console plus library and executes 42', 'offline ZIP export has standard CRC-valid project files', 'offline ZIP import restores original solution and startup', 'offline multi-file item wizard updates the library project', 'offline designer property editing and undo', 'offline per-instance templates and shared styles', 'offline saved design survives standard ZIP export', 'offline generated C# application dispatches real callbacks', 'offline live designer retains control identity and handler', 'offline structural Edit and Continue adds a method and preserves locals', 'offline C# source-linked property updates retain hand-written handlers', 'offline editor-to-designer sync and grouped chrome', 'offline closed collections enumerate and format', 'offline regular and verbatim interpolated strings', 'offline deterministic animation runs managed Completed after Main', 'offline preview language gates and collection capacity', 'offline field-backed property and skipped conditional assignment', 'offline JSON parsing and serialization', 'offline real WebAssembly SIMD128 vector execution', 'offline nested compute workers complete three managed tasks', 'offline HTTP permission denies requests before fetch', 'offline language/backend/networking control panel', 'no JavaScript errors'],
            'errors': errors,
            'caveat': 'Injected as HTML into an about:blank Chromium page. Native file-URL storage/persistence and normal network navigation were not tested.'
        }
        (ROOT / 'docs' / 'standalone-results.json').write_text(
            json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    finally:
        browser.close()
