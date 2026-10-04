"""Execute one explicitly scheduled ordinal qualification phase, preserving prior evidence."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

recorder = Path(__file__).resolve()
repo = recorder.parents[4]
overlay_path = recorder.with_name('ordinal-validation-plan.json')
overlay_bytes = overlay_path.read_bytes()
assert hashlib.sha256(overlay_bytes).hexdigest() == 'ae961b141b1e7fcdc99da39cdbce7685d2fefc8da8ab368df66fd4433d596c6a'
overlay = json.loads(overlay_bytes)
assert repo == Path(overlay['candidateCheckout'])
base_bytes = (repo / overlay['basePlan']['path']).read_bytes()
assert hashlib.sha256(base_bytes).hexdigest() == overlay['basePlan']['sha256']
base = json.loads(base_bytes)
assert hashlib.sha256((repo / overlay['baseRecorder']['path']).read_bytes()).hexdigest() == overlay['baseRecorder']['sha256']
assert len(sys.argv) == 2 and sys.argv[1] in overlay['order'], 'Pass one explicitly scheduled phase'
step = sys.argv[1]
directory = Path(overlay['paths']['execution'])
directory.mkdir(exist_ok=True)
record_path = directory / (step + '.execution.json')
assert not record_path.exists(), 'Never overwrite a completed or failed phase'
for previous in overlay['order'][:overlay['order'].index(step)]:
    result = json.loads((directory / (previous + '.execution.json')).read_bytes())
    assert result['status'] == 'passed' and result['exitCode'] == 0, 'Prior phase must have actually passed'
if step == 'native':
    assert shutil.disk_usage(repo).free >= overlay['disk']['minimumFreeBeforeFreshCaptureBytes']
    assert not Path(overlay['paths']['nativeCapture']).exists()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode().strip()


def file_fact(name):
    data = (repo / name).read_bytes()
    return {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def snapshot():
    product = overlay['productCommit']
    head = git('rev-parse', 'HEAD')
    git('merge-base', '--is-ancestor', product, head)
    git('diff', '--exit-code', product, '--', ':(glob)packages/*/src/**', ':(glob)packages/*/package.json', 'package.json')
    receipt = json.loads((repo / overlay['sourceRevisionReceipt']).read_bytes())
    for row in receipt['files']:
        assert file_fact(row['path'])['sha256'] == row['afterSha256'], 'Exact corrected source/test bytes'
    evidence = overlay['immutableEvidence']
    immutable = git('ls-tree', '-r', '--name-only', evidence['commit'], '--', *evidence['prefixes']).splitlines()
    assert immutable
    git('diff', '--exit-code', evidence['commit'], '--', *immutable)
    names = base['prerequisites']['candidatePublicAliases']
    paths = ['packages/' + name + '/src' for name in names]
    paths += ['packages/' + name + '/package.json' for name in names]
    paths += base['nodeGate']['focusedFiles'] + base['nodeGate']['adjacentFiles']
    paths += ['package.json', 'packages/cil/tools', 'scripts/limited.js', 'scripts/planning/lib/resource-limits.js',
              'scripts/conformance/oracle/toolchain.js', 'scripts/conformance/oracle/process.js',
              'scripts/conformance/static/allowlist.json', 'tests/fixtures/metadata-generations',
              'tests/fixtures/portable-pdb-generations', 'tests/fixtures/a03-metadata',
              'tests/fixtures/metadata-table-views', 'tests/fixtures/inspector-navigation',
              'tests/support/cli-metadata-delta.js', 'tests/support/pdb-delta.js']
    tracked = git('ls-files', '--', *paths).splitlines()
    return {'head': head, 'tree': git('rev-parse', 'HEAD^{tree}'), 'productCommit': product,
            'trackedChanges': git('status', '--porcelain', '--untracked-files=no'),
            'files': [file_fact(name) for name in sorted(set(tracked))],
            'immutableEvidence': [file_fact(name) for name in immutable]}


for name in base['prerequisites']['candidatePublicAliases']:
    alias = repo / 'node_modules/@sharpforge' / name
    target = repo / 'packages' / name
    assert (target / 'package.json').is_file()
    alias.parent.mkdir(parents=True, exist_ok=True)
    if not alias.exists() and not alias.is_symlink():
        alias.symlink_to(Path('../../packages') / name)
    assert alias.resolve(strict=True) == target, 'Own public package alias'
before = snapshot()
assert not before['trackedChanges'], 'Freeze tracked source before qualification'
manifest = base['prerequisites']['originalManifest']
assert file_fact(manifest['path'])['sha256'] == manifest['sha256']
environment = dict(os.environ)
environment.update(overlay['environment'])
if step == 'native':
    environment.update(overlay['nativeEnvironment'])
assert not environment.get('CI'), 'The local limited wrapper must retain its machine-wide slot'
argv = overlay['commands'].get(step)
record = {
    'schemaVersion': 1, 'step': step, 'status': 'running', 'argv': argv,
    'recorderArgv': [sys.executable, *sys.argv], 'cwd': str(repo), 'sourceBefore': before,
    'basePlanSha256': hashlib.sha256(base_bytes).hexdigest(), 'overlaySha256': hashlib.sha256(overlay_bytes).hexdigest(),
    'recorderSha256': hashlib.sha256(recorder.read_bytes()).hexdigest(),
    'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'availableDiskBytesBefore': shutil.disk_usage(repo).free,
    'environment': {name: environment.get(name) for name in ['CI', 'NODE_OPTIONS', 'SHARPFORGE_MAX_PARALLEL_RUNS',
        'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_OLD_SPACE_MB', 'SHARPFORGE_ORACLE_DOTNET', 'DOTNET_ROOT']},
    'outputs': [],
}


def save():
    record_path.write_text(json.dumps(record, indent=2) + '\n')


def retain_native():
    source = Path(overlay['paths']['nativeCapture'])
    destination = repo / overlay['paths']['retainedNative']
    assert not destination.exists() and not destination.is_symlink(), 'Use a fresh reference directory'
    native = json.loads((source / 'native.json').read_bytes())
    assert native['status'] == 'native-and-node-replay-completed'
    assert native['sourceCommit'] == before['head'], 'Capture belongs to this frozen source head'
    assert len(native['commands']) == 4
    assert all(row['result']['exitCode'] == 0 and row['result']['signal'] is None for row in native['commands'])
    record['copy'] = {'source': str(source), 'destination': str(destination), 'files': []}
    for name in base['native']['retainRelativePaths']:
        data = (source / name).read_bytes()
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(data)
        retained = target.read_bytes()
        assert retained == data
        record['copy']['files'].append({'path': name, 'bytes': len(data),
            'sourceSha256': hashlib.sha256(data).hexdigest(), 'retainedSha256': hashlib.sha256(retained).hexdigest()})
        save()
    assert len(record['copy']['files']) == 20


save()
try:
    if step == 'retain-native':
        retain_native()
        record.update({'status': 'passed', 'exitCode': 0, 'signal': None})
    else:
        stdout_path = directory / (step + '.stdout.txt')
        stderr_path = directory / (step + '.stderr.txt')
        with stdout_path.open('xb') as out, stderr_path.open('xb') as err:
            process = subprocess.run(argv, cwd=repo, env=environment, stdout=out, stderr=err)
        record.update({'status': 'passed' if process.returncode == 0 else 'failed',
            'returnCode': process.returncode, 'exitCode': process.returncode if process.returncode >= 0 else None,
            'signal': signal.Signals(-process.returncode).name if process.returncode < 0 else None})
        for path in [stdout_path, stderr_path]:
            data = path.read_bytes()
            record['outputs'].append({'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
except Exception as error:
    record.update({'status': 'failed', 'error': repr(error)})
finally:
    record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record['availableDiskBytesAfter'] = shutil.disk_usage(repo).free
    try:
        record['sourceAfter'] = snapshot()
        record['sourcesUnchanged'] = before == record['sourceAfter']
        assert record['sourcesUnchanged']
    except Exception as error:
        record.update({'status': 'failed', 'sourceVerificationError': repr(error)})
    save()
print(json.dumps({key: value for key, value in record.items() if key not in ['sourceBefore', 'sourceAfter', 'copy']}))
for output in record['outputs']:
    if output['path'].endswith('.stdout.txt') or record['status'] != 'passed':
        print(Path(output['path']).read_text()[-3000:])
sys.exit(0 if record['status'] == 'passed' else 1)
