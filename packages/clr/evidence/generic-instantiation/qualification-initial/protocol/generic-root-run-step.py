import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path('/workspace/scratch/7e3d2a445c44')
plan_path = root / 'generic-2042-validation-plan.json'
plan_bytes = plan_path.read_bytes()
assert hashlib.sha256(plan_bytes).hexdigest() == '876d7cfd763c9a7d9057775450563f3978a97f051d23798335ad37fa4c73895a'
plan = json.loads(plan_bytes)
step = next(value for value in plan['steps'] if value['id'] == sys.argv[1])
assert 'argv' in step
repo = Path(step['cwd'])
directory = Path(plan['qualificationDirectory'])
record_path = directory / (step['id'] + '.execution.json')
assert not record_path.exists()
if step['id'] == 'native-capture-first':
    assert shutil.disk_usage(root).free >= 402653184
    assert not (directory / 'native-first').exists()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode().strip()

def snapshot():
    files = []
    for pin in plan['candidate']['filePins']:
        data = (repo / pin['path']).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        assert len(data) == pin['bytes'] and digest == pin['sha256'], pin['path']
        files.append({'path': pin['path'], 'bytes': len(data), 'sha256': digest})
    sources = []
    for pin in plan['candidate']['sourceDirectories']:
        digest = hashlib.sha256()
        paths = git('ls-files', '--', pin['directory']).splitlines()
        for path in paths:
            data = (repo / path).read_bytes()
            digest.update(path.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
        assert digest.hexdigest() == pin['contentSha256'], pin['directory']
        sources.append({'path': pin['directory'], 'files': len(paths), 'sha256': digest.hexdigest()})
    aliases = []
    for alias in plan['workspaceDependencies']['aliases']:
        actual = (repo / alias['path']).resolve(strict=True)
        expected = repo / 'packages' / alias['name'].split('/')[-1]
        assert actual == expected, alias['name']
        aliases.append({'name': alias['name'], 'target': str(actual)})
    return {'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
            'trackedChanges': git('status', '--porcelain', '--untracked-files=no'),
            'files': files, 'sources': sources, 'aliases': aliases}

before = snapshot()
environment = dict(os.environ)
environment.update(step.get('environment', {}))
assert not environment.get('CI')
record = {'step': step['id'], 'status': 'running', 'planSha256': hashlib.sha256(plan_bytes).hexdigest(),
          'recorderSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'argv': step['argv'], 'cwd': str(repo), 'sourceBefore': before,
          'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'availableDiskBytesBefore': shutil.disk_usage(root).free,
          'environment': {name: environment.get(name) for name in ['CI', 'NODE_OPTIONS', 'SHARPFORGE_TEST_CONCURRENCY',
              'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_MAX_OLD_SPACE_MB', 'DOTNET_ROOT', 'SHARPFORGE_ORACLE_DOTNET']}}
record_path.write_text(json.dumps(record, indent=2) + '\n')
with Path(step['stdout']).open('xb') as stdout, Path(step['stderr']).open('xb') as stderr:
    process = subprocess.run(step['argv'], cwd=repo, env=environment, stdout=stdout, stderr=stderr)
record.update({'status': 'passed' if process.returncode == 0 else 'failed', 'exitCode': process.returncode,
               'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'availableDiskBytesAfter': shutil.disk_usage(root).free, 'outputs': []})
try:
    record['sourceAfter'] = snapshot()
    record['sourcesUnchanged'] = before == record['sourceAfter']
    assert record['sourcesUnchanged']
except Exception as error:
    record['sourceVerificationError'] = repr(error)
    record['status'] = 'failed'
for key in ['stdout', 'stderr']:
    path = Path(step[key]); data = path.read_bytes()
    record['outputs'].append({'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
record_path.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({key: value for key, value in record.items() if key not in ['sourceBefore', 'sourceAfter']}))
if process.returncode:
    print(Path(step['stderr']).read_text()[-5000:])
    print(Path(step['stdout']).read_text()[-5000:])
sys.exit(0 if record['status'] == 'passed' else 1)
