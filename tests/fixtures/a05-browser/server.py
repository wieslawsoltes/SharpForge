"""Actual HTTP modules with the shipped CSP plus a hash for the fixture import map."""
import base64
from contextlib import contextmanager
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading


def source_handler(root):
    imports = {}
    for package in sorted((root / 'packages').glob('*/package.json')):
        metadata = json.loads(package.read_text(encoding='utf8'))
        imports[metadata['name']] = '/' + (package.parent.relative_to(root) / metadata.get('main', 'src/index.js')).as_posix()
    import_map = json.dumps({'imports': imports}, separators=(',', ':'))
    digest = base64.b64encode(hashlib.sha256(import_map.encode()).digest()).decode()
    shipped = subprocess.check_output(['node', '--input-type=module', '-e',
        "import {createBrowserCsp} from '@sharpforge/network'; process.stdout.write(createBrowserCsp());"],
        cwd=root, text=True, timeout=15).strip()
    if "script-src 'self' 'wasm-unsafe-eval'" not in shipped or "'unsafe-eval'" in shipped:
        raise AssertionError('Unexpected shipped browser script CSP')
    policy = shipped.replace("script-src 'self'", "script-src 'self' 'sha256-" + digest + "'")
    html = ('<!doctype html><meta charset="utf-8"><title>A05 browser runtime qualification</title>'
            '<script type="importmap">' + import_map + '</script><main>A05 browser runtime qualification</main>').encode()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *args):
            pass

        def end_headers(self):
            selected = policy.replace(" 'wasm-unsafe-eval'", '') if self.path == '/denied.html' else policy
            self.send_header('Content-Security-Policy', selected)
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def do_GET(self):
            if self.path not in ('/allowed.html', '/denied.html'):
                return super().do_GET()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)

    return Handler, {'shipped': shipped, 'allowed': policy, 'denied': policy.replace(" 'wasm-unsafe-eval'", ''),
                     'importMapSha256': hashlib.sha256(import_map.encode()).hexdigest()}


def ui_handler(directory):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def log_message(self, *args):
            pass
    return Handler


@contextmanager
def serving(handler):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
