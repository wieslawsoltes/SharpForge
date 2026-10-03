"""Run the same compiler/VM probes inside the production browser application.

The result contains every observed failure. Gaps are data, not test-runner errors;
only harness integrity and the known arithmetic/disposal/array canaries gate this
inventory job. This artifact is never labeled native execution evidence.
"""
from pathlib import Path
import json
import os
import hashlib
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from browser_harness import load_application

runner = (ROOT / 'scripts/conformance/inventory/runtime-runner.js').read_text(encoding='utf-8')
runner = '\n'.join(line for line in runner.splitlines() if not line.startswith('import ')).replace('export ', '')
fixtures = json.loads((ROOT / 'tests/conformance/inventory/probes/runtime.json').read_text(encoding='utf-8'))['fixtures']
language = json.loads((ROOT / 'tests/conformance/inventory/probes/csharp.json').read_text(encoding='utf-8'))['features']
for feature in language:
    feature['source'] = (ROOT / feature['probe']).read_text(encoding='utf-8')
script = '''async data => {
const {compile,compileToIL}=await __sharpforgeTestImport('/packages/compiler/src/index.js');
const {VirtualMachine,CilVirtualMachine}=await __sharpforgeTestImport('/packages/runtime/src/index.js');
''' + runner + '''
const runtime=await runtimeObservations(data.fixtures);
const language=data.language.map(f=>{
 try {const result=compile(f.source,{langVersion:f.langVersion,outputKind:f.outputKind||'library',allowUnsafe:true});return {id:f.id,accepted:result.success,diagnostics:result.diagnostics.map(d=>({code:d.code,message:d.message}))};}
 catch(error){return {id:f.id,accepted:false,error:error.message};}
});
return {runtime,language};
}'''
engine = os.environ.get('SHARPFORGE_BROWSER_ENGINE', 'chromium')
if engine not in ('chromium', 'firefox', 'webkit'):
    raise ValueError('Unsupported inventory browser engine: ' + engine)
target = 'browser-' + engine
with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
    # Older launchers default to Chromium. Never label that execution as another engine.
    if browser.browser_type.name != engine:
        raise RuntimeError('Requested ' + engine + ' but shared launcher started ' + browser.browser_type.name)
    page = browser.new_page()
    load_application(page)
    result = page.evaluate(script, {'fixtures': fixtures, 'language': language})
    result.update(schemaVersion=1, platform=target, host=platform.platform(), browser=browser.version,
                  inputDigest=hashlib.sha256(json.dumps({'runner': runner, 'fixtures': fixtures, 'language': language}, sort_keys=True).encode('utf-8')).hexdigest(),
                  command='python tests/conformance/inventory/browser_probe.py',
                  commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True, encoding='utf-8').strip(),
                  meaning='Per-fixture browser observations; gaps remain failures, not native or total parity evidence')
    output = results_dir() / 'inventory' / target
    output.mkdir(parents=True, exist_ok=True)
    (output / 'report.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    assert len(result['runtime']) == len(fixtures) * 2
    assert len(result['language']) == len(language)
    canaries = [r for r in result['runtime'] if r['id'] in ['execution-int32', 'execution-dispose', 'execution-array-positive']]
    assert len(canaries) == 6 and all(r['status'] == 'pass' for r in canaries), canaries
    print(json.dumps({'runtimeObservations': len(result['runtime']), 'languageObservations': len(result['language']),
                      'runtimePassingProbes': sum(r['status'] == 'pass' for r in result['runtime']), 'fullParity': 'unknown'}))
