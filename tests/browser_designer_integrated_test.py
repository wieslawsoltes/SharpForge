"""Run the integrated Node browser gate through the existing Python area-manifest seam."""
import importlib.util
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def playwright_module():
    explicit = os.getenv('PLAYWRIGHT_MODULE')
    if explicit:
        return explicit
    modules = os.getenv('CODEX_PRIMARY_RUNTIME_NODE_MODULES')
    if modules:
        candidate = Path(modules) / 'playwright' / 'index.mjs'
        if candidate.is_file():
            return str(candidate)
    spec = importlib.util.find_spec('playwright')
    if spec and spec.origin:
        candidate = Path(spec.origin).parent / 'driver' / 'package' / 'index.js'
        if candidate.is_file():
            return str(candidate)
    return None


def available_port():
    with socket.socket() as channel:
        channel.bind(('127.0.0.1', 0))
        return channel.getsockname()[1]


def wait_server(url, server):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError('The production Studio server exited before browser qualification')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError):
            time.sleep(.05)
    raise TimeoutError('The production Studio server did not become ready')


def main(driver='tests/browser_designer_integrated_gate.mjs', server_log='designer-integrated-server.log'):
    node = os.getenv('NODE') or os.getenv('CODEX_PRIMARY_RUNTIME_NODE') or 'node'
    environment = dict(os.environ)
    module = playwright_module()
    if module:
        environment['PLAYWRIGHT_MODULE'] = module
    results = Path(environment.get('SHARPFORGE_RESULTS_DIR') or ROOT / 'artifacts' / 'results')
    results.mkdir(parents=True, exist_ok=True)
    environment['SHARPFORGE_RESULTS_DIR'] = str(results.resolve())
    server = None
    try:
        with (results / server_log).open('w', encoding='utf-8') as log:
            if not environment.get('SHARPFORGE_BROWSER_URL'):
                port = available_port()
                environment['SHARPFORGE_BROWSER_URL'] = f'http://127.0.0.1:{port}'
                server = subprocess.Popen([node, 'scripts/serve.js'], cwd=ROOT,
                                          env={**environment, 'PORT': str(port)}, stdout=log, stderr=log)
                wait_server(environment['SHARPFORGE_BROWSER_URL'], server)
            completed = subprocess.run([node, driver], cwd=ROOT,
                                       env=environment, timeout=1200, check=False)
            return completed.returncode
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


def interrupted(_signal, _frame):
    raise KeyboardInterrupt('Designer browser qualification cancelled')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main())
