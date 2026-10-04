"""Original byte corpus and bounded native host lifecycle for Explorer acceptance."""
from contextlib import contextmanager
from pathlib import Path
from queue import Queue
from threading import Thread
from urllib.parse import urlparse
import base64
import hashlib
import http.client
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / 'tests/fixtures/workspace-corpus'


def load_corpus():
    cases = json.loads((CORPUS / 'manifest.json').read_text(encoding='utf8'))['cases']
    for case in cases:
        case['records'] = []
        for file in case['files']:
            raw = (CORPUS / 'cases' / case['id'] / file['path']).read_bytes()
            assert len(raw) == file['size'], file['path']
            assert hashlib.sha256(raw).hexdigest() == file['sha256'], file['path']
            case['records'].append({'path': file['path'], 'base64': base64.b64encode(raw).decode()})
    return cases


def materialize(case, root):
    for folder in case['folders']:
        (root / folder).mkdir(parents=True, exist_ok=True)
    for record in case['records']:
        path = root / record['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(record['base64']))


def disk_snapshot(root):
    files, folders = [], []
    for path in root.rglob('*'):
        name = path.relative_to(root).as_posix()
        if name == '.sharpforge' or name.startswith('.sharpforge/'):
            continue
        if path.is_dir():
            folders.append(name)
        elif path.is_file():
            raw = path.read_bytes()
            files.append({'path': name, 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        else:
            raise AssertionError('Unexpected corpus entry: ' + name)
    return {'files': sorted(files, key=lambda file: file['path']), 'folders': sorted(folders)}


def assert_original(case, snapshot):
    actual = {file['path']: file for file in snapshot['files']}
    expected = {file['path']: file for file in case['files']}
    assert actual == expected, json.dumps({'expected': expected, 'actual': actual}, ensure_ascii=False, indent=2)
    assert set(case['folders']).issubset(snapshot['folders']), case['id'] + ': empty directories missing'


@contextmanager
def native_host(case):
    with tempfile.TemporaryDirectory(prefix='sharpforge-explorer-corpus-') as temporary:
        root = Path(temporary)
        materialize(case, root)
        script = """
import {startMSBuildHost} from '@sharpforge/msbuild/node';
const host = await startMSBuildHost({root: process.argv[1], port: 0, trusted: false});
console.log(JSON.stringify({origin: host.origin, token: host.token}));
process.on('SIGTERM', async () => { await host.close(); process.exit(0); });
"""
        process = subprocess.Popen(
            ['node', '--input-type=module', '-e', script, str(root)], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf8',
        )
        messages = Queue()
        Thread(target=lambda: messages.put(process.stdout.readline()), daemon=True).start()
        try:
            ready = json.loads(messages.get(timeout=20))
            address = urlparse(ready['origin'])

            def forward(path, options):
                assert path.startswith('/api/msbuild/'), 'Unexpected bridge path'
                headers = dict(options.get('headers') or {})
                headers['Origin'] = ready['origin']
                body = options.get('body')
                connection = http.client.HTTPConnection(address.hostname, address.port, timeout=20)
                try:
                    connection.request(options.get('method', 'GET'), path,
                                       body=body.encode() if body is not None else None, headers=headers)
                    response = connection.getresponse()
                    return {'status': response.status, 'headers': dict(response.getheaders()),
                            'bytes': base64.b64encode(response.read()).decode()}
                finally:
                    connection.close()

            yield root, ready['token'], forward
        finally:
            process.terminate()
            try:
                process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)
