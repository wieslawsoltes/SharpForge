"""Actual production Studio startup/compile/input/tool latency. Every requested engine must run.
Traces contain all samples, including failures; no in-memory browser or native allocation claim.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import signal
import socket
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
cancelled = False


def check_cancel():
    if cancelled or (os.getenv('SHARPFORGE_CANCEL_FILE') and Path(os.environ['SHARPFORGE_CANCEL_FILE']).exists()):
        raise InterruptedError('Performance browser run cancelled')


def wait(page, expression, timeout=30000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        check_cancel()
        if page.evaluate(expression):
            return
        time.sleep(.01)
    raise TimeoutError(expression)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def run(engine, iterations, output):
    from playwright.sync_api import sync_playwright
    check_cancel()
    if git('status', '--porcelain', '--untracked-files=all'):
        raise RuntimeError('Browser measurement requires clean source')
    head = git('rev-parse', 'HEAD')
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    log = (output / 'server.log').open('w', encoding='utf8')
    ready = queue.Queue()
    server = subprocess.Popen(['node', 'scripts/serve.js'], cwd=ROOT,
        env={**os.environ, 'PORT': str(port)}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    def read_server():
        for line in server.stdout:
            log.write(line); log.flush()
            if line.startswith('SharpForge Studio: '):
                ready.put(line.split('SharpForge Studio: ', 1)[1].strip())
    thread = threading.Thread(target=read_server, daemon=True); thread.start()
    values = {name: [] for name in ['startup', 'firstCompile', 'typing', 'toolActivation']}
    traces = []
    errors = []
    browser_version = ''
    try:
        url = ready.get(timeout=20)
        with sync_playwright() as playwright:
            for index in range(iterations):
                check_cancel()
                started = time.perf_counter()
                options = {'headless': True}
                if engine == 'chromium' and os.getenv('CHROMIUM_EXECUTABLE'):
                    options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
                browser = getattr(playwright, engine).launch(**options)
                browser_version = browser.version
                context = browser.new_context(viewport={'width': 1440, 'height': 900})
                context.tracing.start(screenshots=True, snapshots=True, sources=True)
                trace = output / (engine + '-' + str(index) + '.zip')
                page = context.new_page()
                page.set_default_timeout(30000)
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    response = page.goto(url)
                    assert response and response.status == 200
                    csp = response.headers.get('content-security-policy', '')
                    assert "script-src 'self'" in csp and "'unsafe-eval'" not in csp
                    wait(page, 'window.sharpforge && window.sharpforge.getState().metrics !== null')
                    values['startup'].append((time.perf_counter() - started) * 1000)
                    state = page.evaluate('window.sharpforge.getState()')
                    assert not [d for d in state['diagnostics'] if d['severity'] == 'error']
                    assert page.evaluate('Array.from(window.sharpforge.getAssembly().slice(0,2))') == [77, 90]
                    values['firstCompile'].append(state['metrics']['compileMs'] + state['metrics'].get('emitIlMs', 0))
                    editor = page.locator('.sf-input:visible').first
                    editor.fill('Console.WriteLine(42);')
                    page.evaluate("window.sharpforge.execute('build')")
                    assert page.evaluate('Array.from(window.sharpforge.getAssembly().slice(0,2))') == [77, 90]
                    for n in range(10):
                        check_cancel()
                        editor.focus()
                        before = editor.input_value()
                        started = time.perf_counter()
                        page.keyboard.press('End')
                        page.keyboard.type(' ')
                        page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                        assert len(editor.input_value()) == len(before) + 1
                        values['typing'].append((time.perf_counter() - started) * 1000)
                        panel = 'output' if n % 2 == 0 else 'problems'
                        started = time.perf_counter()
                        page.click('[data-dock-tab="' + panel + '"]')
                        page.evaluate('() => new Promise(resolve => requestAnimationFrame(resolve))')
                        assert page.evaluate('window.sharpforge.getState().panel') == panel
                        assert page.locator('[data-tool="' + panel + '"]').is_visible()
                        values['toolActivation'].append((time.perf_counter() - started) * 1000)
                    assert not errors, errors
                finally:
                    context.tracing.stop(path=str(trace))
                    traces.append({'path': trace.name, 'sha256': hashlib.sha256(trace.read_bytes()).hexdigest()})
                    context.close()
                    browser.close()
        if git('rev-parse', 'HEAD') != head or git('status', '--porcelain', '--untracked-files=all'):
            raise RuntimeError('Source changed while measuring browser')
        raw = {'schemaVersion': 1, 'commit': head, 'engine': engine, 'browser': browser_version,
            'samples': values, 'traces': traces, 'correctness': True,
            'measurement': {'startup': 'fresh browser launch through first correct PE/CLI build; tracing enabled',
                'firstCompile': 'worker-reported first compile plus IL emission time',
                'typing': 'real keyboard input through two animation frames; protocol overhead included',
                'toolActivation': 'real dock click through visible panel and animation frame'},
            'unsupported': [{'target': e, 'reason': 'Engine not requested in this independent run'} for e in ['chromium', 'firefox', 'webkit'] if e != engine]}
        (output / 'raw.json').write_text(json.dumps(raw, indent=2) + '\n', encoding='utf8')
        subprocess.run(['node', 'scripts/conformance/perf/normalize-browser.js', '--root', str(ROOT),
            '--input', str(output / 'raw.json'), '--output', str(output / 'benchmark.json')], cwd=ROOT, check=True)
        return raw
    finally:
        (output / 'session.json').write_text(json.dumps({'errors': errors, 'traces': traces, 'samples': values, 'cancelled': cancelled}, indent=2) + '\n')
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill(); server.wait()
        thread.join(timeout=2)
        log.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    parser.add_argument('--iterations', type=int, default=5)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/results/performance/browser')
    opts = parser.parse_args()
    if not 3 <= opts.iterations <= 50:
        parser.error('--iterations must be 3–50')
    def cancel(signum, frame):
        global cancelled
        cancelled = True
    for name in ['SIGINT', 'SIGTERM']:
        signal.signal(getattr(signal, name), cancel)
    result = run(opts.engine, opts.iterations, opts.output.resolve())
    print(json.dumps({'engine': result['engine'], 'browser': result['browser'], 'measurements': {k: len(v) for k, v in result['samples'].items()}}))
