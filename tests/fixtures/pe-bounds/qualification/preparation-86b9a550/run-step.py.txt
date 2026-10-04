"""Prepared serial recorder. Execute only after the root grants the sole heavy slot."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
PLAN_PATH = ROOT / 'tests/fixtures/pe-bounds/validation-plan.json'
PLAN_BYTES = PLAN_PATH.read_bytes()
PLAN = json.loads(PLAN_BYTES)
STEPS = ['native', 'verify-external', 'retain-native', 'verify-retained', 'focused', 'performance']
assert len(sys.argv) == 2 and sys.argv[1] in STEPS
STEP = sys.argv[1]
DESTINATION = Path(PLAN['executionDirectory'])
DESTINATION.mkdir(exist_ok=True)
RECEIPT = DESTINATION / (STEP + '.execution.json')
assert not RECEIPT.exists(), 'Never overwrite an earlier phase receipt'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def snapshot():
    git('diff', '--exit-code', PLAN['productCommit'], '--', ':(glob)packages/*/src/**',
        ':(glob)packages/*/package.json', 'package.json')
    paths = git('ls-files', '--', 'packages/cil', 'packages/bytecode/src', 'packages/framework/src',
                'packages/bcl-core/src', 'packages/bcl-collections/src', 'packages/symbols/src',
                'packages/archive/src', 'scripts', 'tests/a03-09-pe-bounds.test.js',
                'tests/a03-09-pe-bounds-native.test.js', 'tests/fixtures/pe-bounds',
                'tests/fixtures/pe-inspection', 'tests/fixtures/decompiler-cfg/native.json',
                'tests/managed-fixtures.js', 'planning/qualification/oracle-toolchain.json').splitlines()
    files = {}
    for name in paths:
        if '/reference/' not in name and '/qualification/' not in name and (ROOT / name).is_file():
            files[name] = digest((ROOT / name).read_bytes())
    return {'head': git('rev-parse', 'HEAD'), 'files': files}


for previous in STEPS[:STEPS.index(STEP)]:
    prior = json.loads((DESTINATION / (previous + '.execution.json')).read_text())
    assert prior['status'] == 'passed' and prior['exitCode'] == 0 and prior['signal'] is None

environment = dict(os.environ)
for key, value in PLAN['environment'].items():
    if value is None:
        environment.pop(key, None)
    else:
        environment[key] = value
record = {'step': STEP, 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'sourceBefore': snapshot(), 'planSha256': digest(PLAN_BYTES),
          'recorderSha256': digest(Path(__file__).read_bytes()), 'cwd': str(ROOT),
          'environment': {key: environment.get(key) for key in [*PLAN['environment'], 'NODE_OPTIONS']},
          'availableDiskBefore': shutil.disk_usage(ROOT).free, 'status': 'running'}
try:
    if STEP == 'retain-native':
        target = ROOT / PLAN['retainedNative']
        assert not target.exists()
        target.mkdir()
        record['copy'] = []
        for name in PLAN['retainNative']['files']:
            data = (Path(PLAN['nativeDirectory']) / name).read_bytes()
            with (target / name).open('xb') as stream:
                stream.write(data)
            assert (target / name).read_bytes() == data
            record['copy'].append({'path': name, 'bytes': len(data), 'sha256': digest(data)})
        record.update(exitCode=0, signal=None)
    else:
        name = {'verify-external': 'verifyExternal', 'verify-retained': 'verifyRetained'}.get(STEP, STEP)
        record['argv'] = PLAN[name]
        stdout = DESTINATION / (STEP + '.stdout.txt')
        stderr = DESTINATION / (STEP + '.stderr.txt')
        with stdout.open('xb') as out, stderr.open('xb') as err:
            completed = subprocess.run(record['argv'], cwd=ROOT, env=environment, stdout=out, stderr=err)
        record['exitCode'] = completed.returncode if completed.returncode >= 0 else None
        record['signal'] = -completed.returncode if completed.returncode < 0 else None
        record['outputs'] = [{'path': str(path), 'bytes': path.stat().st_size,
                              'sha256': digest(path.read_bytes())} for path in [stdout, stderr]]
    record['sourceAfter'] = snapshot()
    record['sourcesUnchanged'] = record['sourceBefore'] == record['sourceAfter']
    assert record['sourcesUnchanged'], 'Source drift during phase'
    assert record['exitCode'] == 0 and record['signal'] is None, 'Phase failed; stop before retry or edits'
    record['status'] = 'passed'
except BaseException as error:
    record['status'] = 'failed'
    record['failure'] = {'name': type(error).__name__, 'message': str(error)}
    raise
finally:
    record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record['availableDiskAfter'] = shutil.disk_usage(ROOT).free
    with RECEIPT.open('x') as output:
        json.dump(record, output, indent=2)
        output.write('\n')
    print(json.dumps({key: value for key, value in record.items() if key not in ['sourceBefore', 'sourceAfter']}))
