"""Common real-browser checks; no DOM/storage/runtime replacement."""
from contextlib import contextmanager
from pathlib import Path
import hashlib
import json
import os
import queue
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
SOURCE = 'Console.WriteLine(42);'

def wait(page, expression, timeout=30000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        value = page.evaluate(expression)
        if value:
            return value
        page.wait_for_timeout(20)
    raise AssertionError('Browser predicate timed out: ' + expression)

def truth(value, message='Assertion failed'):
    if not value:
        raise AssertionError(message)

def policy(headers, meta=None):
    value = headers.get('content-security-policy', '') or meta or ''
    # Pages cannot supply custom headers: an actual early CSP meta is supported,
    # but the deployment probe explicitly records which transport enforced it.
    parts = {x.strip().split()[0]: x.strip().split()[1:] for x in value.split(';') if x.strip()}
    truth("'self'" in parts.get('script-src', []), 'Required script-src self CSP is missing')
    truth("'unsafe-eval'" not in parts.get('script-src', []), 'CSP allows unsafe-eval')
    truth("'unsafe-inline'" not in parts.get('script-src', []), 'CSP allows inline scripts')
    truth(parts.get('object-src') == ["'none'"], 'CSP must deny object sources')
    return {'value': value, 'transport': 'header' if headers.get('content-security-policy') else 'meta'}

@contextmanager
def serving(mode):
    command = [os.getenv('NODE', 'node'), 'scripts/conformance/serve-modes.js', '--mode', mode]
    if mode != 'http':
        fixtures = ROOT / 'tests/conformance/browser/fixtures'
        command += ['--cert', str(fixtures/'localhost-cert.pem'), '--key', str(fixtures/'localhost-key.pem')]
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
    ready, lines = queue.Queue(), []
    def output():
        for line in process.stdout:
            lines.append(line.rstrip())
            if line.startswith('SharpForge qualification: '):
                ready.put(line.split(': ', 1)[1].strip())
    threading.Thread(target=output, daemon=True).start()
    try:
        try:
            url = ready.get(timeout=20)
        except queue.Empty as error:
            raise RuntimeError('Serving-mode startup failed: ' + repr(lines)) from error
        yield url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()
        process.stdout.close()

class Checks:
    def __init__(self, page, directory):
        self.page, self.directory, self.rows = page, Path(directory), []
        self.directory.mkdir(parents=True, exist_ok=True)

    def check(self, name, fn):
        start = time.perf_counter()
        try:
            details = fn()
            row = {'id': name, 'status': 'passed', 'details': details}
        except Exception as error:
            row = {'id': name, 'status': 'failed', 'error': str(error), 'errorType': type(error).__name__}
            try:
                row['productState']=self.page.evaluate('window.sharpforge ? (()=>{const s=sharpforge.getState();return {diagnostics:s.diagnostics,debug:s.debug?{state:s.debug.state,fault:s.debug.fault,runtime:s.debug.runtime}:null};})() : null')
            except Exception:
                pass
            screenshot = self.directory / (name + '.png')
            try:
                self.page.screenshot(path=str(screenshot), full_page=True, timeout=5000)
                row['screenshot'] = str(screenshot)
            except Exception as shot_error:
                row['screenshotError'] = str(shot_error)
        row['milliseconds'] = (time.perf_counter()-start)*1000
        self.rows.append(row)
        print(row['status'].upper(), name, row.get('error', ''), flush=True)
        return row

    def unsupported(self, name, reason):
        self.rows.append({'id': name, 'status': 'unsupported', 'reason': reason})

def load(page, url, *, mode, observation=None):
    observation = {} if observation is None else observation
    response = page.goto(url, wait_until='domcontentloaded')
    headers = response.headers if response else {}
    observation.update({'url':page.url,'status':response.status if response else None,'headers':headers,'policy':{'value':headers.get('content-security-policy'),'transport':'header' if headers.get('content-security-policy') else 'missing'}})
    if mode != 'file':
        truth(response is not None and response.status == 200, 'Navigation must return HTTP 200')
    wait(page, 'window.sharpforge && window.sharpforge.getState().metrics !== null')
    if mode not in ('file', 'in-memory'):
        meta = page.locator('meta[http-equiv="Content-Security-Policy" i]')
        meta_value = meta.first.get_attribute('content') if meta.count() else None
        result = policy(headers, meta_value)
        if result['transport'] == 'meta':
            truth(page.evaluate('''() => {const m=document.querySelector('meta[http-equiv="Content-Security-Policy" i]');return [...document.scripts].every(s=>Boolean(m.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING));}'''), 'CSP meta occurs after a script')
    else:
        result = {'transport': 'standalone embedded policy', 'value': None}
    observation['policy']=result
    return observation

def source(page, text=SOURCE):
    page.evaluate('sharpforge.execute("stop")')
    page.evaluate('text=>sharpforge.loadDiskRecords([{path:"Program.cs",text}],{name:"BrowserQualification"})', text)
    page.evaluate('sharpforge.build()')
    wait(page, 'sharpforge.getState().metrics !== null')

def run(page):
    page.evaluate('sharpforge.run()')
    wait(page, 'sharpforge.getState().debug?.state==="terminated"')
    debug = page.evaluate('sharpforge.getState().debug')
    truth(not debug.get('fault'), repr(debug.get('fault')))
    return debug

def compile_run(page):
    source(page)
    truth(not page.evaluate('sharpforge.getState().diagnostics'), 'Unexpected compiler diagnostics')
    truth(page.evaluate('Array.from(sharpforge.getAssembly().slice(0,2))') == [77,90], 'Compiler did not produce a PE image')
    value = run(page)
    truth(value['output'] == '42\n', 'Unexpected output: '+repr(value['output']))
    return {'output': value['output'], 'artifactFormat': value['stats'].get('artifactFormat')}

def debug(page):
    source(page, 'int answer=40;\nanswer=answer+2;\nConsole.WriteLine(answer);')
    page.evaluate('sharpforge.setBreakpoints("Program.cs",[{line:2}]);sharpforge.debug()')
    wait(page, 'sharpforge.getState().debug?.state==="paused"')
    before = page.evaluate('sharpforge.getState().debug.point.line')
    truth(before == 2, 'Debugger did not stop at requested breakpoint')
    page.evaluate('sharpforge.step("next")')
    wait(page, 'sharpforge.getState().debug?.point?.line===3')
    page.evaluate('sharpforge.setBreakpoints("Program.cs",[]);sharpforge.debug()')
    wait(page, 'sharpforge.getState().debug?.state==="terminated"')
    truth(page.evaluate('sharpforge.getState().debug.output') == '42\n')

def negative(page):
    source(page, 'int answer = "wrong";')
    truth(any(d['code']=='CS0029' for d in page.evaluate('sharpforge.getState().diagnostics')), 'Malformed program missing diagnostic')
    compile_run(page)

def cancellation(page):
    source(page, 'while(true) { }')
    page.evaluate('void sharpforge.run()')
    # Stop travels to the real runtime worker; no blocking evaluate awaits the run.
    page.evaluate('sharpforge.execute("stop")')
    wait(page, 'sharpforge.getState().debug?.state==="terminated"')
    compile_run(page)

def smoke(checks, *, mode, iterations=3):
    page = checks.page
    checks.check('compile-run', lambda: compile_run(page))
    checks.check('debug-step-continue', lambda: debug(page))
    checks.check('malformed-repair', lambda: negative(page))
    checks.check('cancel-and-reuse', lambda: cancellation(page))
    def unicode():
        source(page, 'Console.WriteLine("héllo λ 🌍");')
        truth(run(page)['output']=='héllo λ 🌍\n')
    checks.check('unicode-boundary', unicode)
    def compute():
        page.evaluate('sharpforge.execute("stop");sharpforge.loadSample("parallel-compute",true)')
        value=run(page)
        truth(value['output']=='sum: 6\ndot: 32\nlast: 9\n')
        truth(value['runtime']['compute']['completed']==3)
        return value['runtime']['compute']
    checks.check('transfer-buffer-compute', compute)
    def isolation():
        value=page.evaluate('({isolated:crossOriginIsolated,secure:isSecureContext,sab:typeof SharedArrayBuffer!=="undefined"})')
        truth(value['isolated']==(mode=='isolated'), repr(value))
        if mode=='isolated':
            truth(value['secure'] and value['sab'], repr(value))
            truth(page.evaluate('Atomics.add(new Int32Array(new SharedArrayBuffer(4)),0,42)')==0)
        return value
    if mode != 'deployed':
        checks.check('browser-isolation-capabilities', isolation)
    checks.unsupported('shared-memory-product-path', 'The product ComputePool uses owned transferable buffers; no SharedArrayBuffer-dependent product path or non-isolated degradation notice exists (A10 dependency).')
    def timing():
        values=[]
        for _ in range(iterations):
            start=time.perf_counter();compile_run(page);values.append((time.perf_counter()-start)*1000)
        ordered=sorted(values)
        import math
        return {'warmCompileAndRunMs':values,'p95Ms':ordered[math.ceil(len(ordered)*.95)-1],'p99Ms':ordered[math.ceil(len(ordered)*.99)-1],'browserAllocations':{'status':'unavailable','reason':'No portable allocation counter is exposed across Chromium, Firefox, and WebKit.'}}
    checks.check('correctness-gated-warm-latency', timing)

def artifact_identity():
    values={}
    for name in ('dist/index.html','dist/studio.js','artifacts/SharpForge-standalone.html'):
        path=ROOT/name
        if path.exists():values[name]=hashlib.sha256(path.read_bytes()).hexdigest()
    return values
