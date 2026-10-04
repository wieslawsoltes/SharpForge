"""Serve editor fixtures with built package modules and the production HTTP server/CSP."""
from contextlib import contextmanager
from pathlib import Path
import os
import queue
import re
import shutil
import socket
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[3]


@contextmanager
def editor_fixture(name):
    """The completed scope must be built once before browser qualification starts."""
    built = ROOT / 'dist/packages'
    if not (built / 'editor/src/index.js').is_file():
        raise RuntimeError('Run npm run build once before the editor browser qualification scope')
    fixtures = ROOT / 'tests/fixtures'
    with tempfile.TemporaryDirectory(prefix='sharpforge-editor-') as directory:
        target = Path(directory)
        shutil.copytree(built, target / 'packages')
        html = (fixtures / (name + '.html')).read_text(encoding='utf8')
        html = re.sub(r'<script\s+type="importmap">[\s\S]*?</script>', '', html)
        (target / 'index.html').write_text(html, encoding='utf8')
        entry = name + '-fixture.js'
        module = (fixtures / entry).read_text(encoding='utf8')
        module = re.sub(r'([\'"])@sharpforge/([\w-]+)\1',
                        lambda match: match[1] + '/packages/' + match[2] + '/src/index.js' + match[1], module)
        (target / entry).write_text(module, encoding='utf8')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        process = subprocess.Popen([os.getenv('NODE', 'node'), 'scripts/serve.js'], cwd=ROOT,
            env={**os.environ, 'SERVE_ROOT': str(target), 'HOST': '127.0.0.1', 'PORT': str(port)},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8')
        ready = queue.Queue()
        output = []

        def read_output():
            for line in process.stdout:
                output.append(line.rstrip())
                if line.startswith('SharpForge Studio: '):
                    ready.put(line.split('SharpForge Studio: ', 1)[1].strip())

        threading.Thread(target=read_output, daemon=True).start()
        try:
            try:
                url = ready.get(timeout=15)
            except queue.Empty as error:
                raise RuntimeError('Production fixture server did not start: ' + repr(output)) from error
            yield url
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
