"""Prepared focused public-API browser qualification; run only in the granted serial slot."""
import base64
import hashlib
import json
import os
import platform
from importlib.metadata import version
from pathlib import Path
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
ROOT = Path(sys.argv[1]).resolve()
OUTPUT = Path(sys.argv[2]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'tests'))
from conformance.browser.launch import launch_browser
from playwright.sync_api import sync_playwright
imports = {}
for package in sorted((ROOT / 'packages').glob('*/package.json')):
    metadata = json.loads(package.read_text())
    entry = metadata.get('main', 'src/index.js')
    imports[metadata['name']] = '/' + str(package.parent.relative_to(ROOT) / entry)
import_map = json.dumps({'imports': imports}, separators=(',', ':'))
digest = base64.b64encode(hashlib.sha256(import_map.encode()).digest()).decode()
html = ('<!doctype html><meta charset="utf-8"><title>A13 indexed symbol search</title>'
        '<script type="importmap">' + import_map + '</script>').encode()
module_path = Path(__file__).with_suffix('.mjs').resolve()
module_url = '/' + module_path.relative_to(ROOT).as_posix()
module = module_path.read_bytes()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'sha256-" + digest + "'; object-src 'none'; base-uri 'none'")
        super().end_headers()
    def do_GET(self):
        data, mime = html, 'text/html'
        if self.path != '/__a13__.html':
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
report = {'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'host': platform.platform(), 'python': sys.version, 'playwright': version('playwright'),
          'moduleSha256': hashlib.sha256(module).hexdigest(), 'mode': 'HTTP source modules/import map, CSP enabled', 'engines': []}
try:
    with sync_playwright() as playwright:
        for engine in ('chromium', 'firefox', 'webkit'):
            os.environ['SHARPFORGE_RESULTS_DIR'] = str(OUTPUT / engine)
            cell = {'engine': engine, 'passed': False}
            report['engines'].append(cell)
            try:
                with launch_browser(playwright, __file__, engine=engine, mode='A13 public source modules') as browser:
                    cell['version'] = browser.version
                    page = browser.new_page()
                    page.goto('http://127.0.0.1:' + str(server.server_port) + '/__a13__.html')
                    result = page.evaluate("async (url) => (await import(url)).run()", module_url)
                    cell.update(result)
                    if not result.get('passed'):
                        raise AssertionError(result)
            except Exception as error:
                cell['error'] = {'type': type(error).__name__, 'message': str(error)}
                report['passed'] = False
                raise
    report['passed'] = True
finally:
    server.shutdown()
    server.server_close()
    thread.join()
    (OUTPUT / 'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
