"""Prepared serial recorder. Execute only after the root grants the sole heavy slot."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
PLAN_PATH = ROOT / 'tests/fixtures/pe-bounds/validation-plan-integration-f009.json'
PLAN_BYTES = PLAN_PATH.read_bytes()
PLAN = json.loads(PLAN_BYTES)
STEPS = ['native', 'verify-external', 'retain-native', 'verify-retained', 'focused', 'performance']
assert len(sys.argv) == 3 and sys.argv[1] in STEPS, 'Usage: run-integration-f009.py <step> <exact-HEAD>'
STEP = sys.argv[1]
EXPECTED_HEAD = sys.argv[2]
assert len(EXPECTED_HEAD) == 40 and all(value in '0123456789abcdef' for value in EXPECTED_HEAD)
DESTINATION = Path(PLAN['executionDirectory'])
DESTINATION.mkdir(exist_ok=True)
RECEIPT = DESTINATION / (STEP + '.execution.json')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def failure(error):
    return {'name': type(error).__name__, 'message': str(error)}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.PIPE).strip()


def snapshot():
    """Collect actual facts before deciding whether they satisfy the frozen source contract."""
    facts = {'files': {}, 'aliases': {}, 'inspectionErrors': []}

    def inspect(label, operation):
        try:
            return operation()
        except Exception as error:
            facts['inspectionErrors'].append({'inspection': label, **failure(error)})
            return None

    facts['head'] = inspect('HEAD', lambda: git('rev-parse', 'HEAD'))
    facts['tree'] = inspect('tree', lambda: git('rev-parse', 'HEAD^{tree}'))
    facts['status'] = inspect('status', lambda: git('status', '--porcelain=v1', '--untracked-files=all'))
    facts['productChangedPaths'] = inspect('product diff', lambda: git('diff', '--name-only', PLAN['productCommit'], '--',
        ':(glob)packages/*/src/**', ':(glob)packages/*/package.json', 'package.json').splitlines())
    paths = inspect('source roster', lambda: git('ls-files', '--', 'packages/cil', 'packages/bytecode/src',
        'packages/framework/src', 'packages/bcl-core/src', 'packages/bcl-collections/src', 'packages/symbols/src',
        'packages/archive/src', 'scripts', *[path for path in PLAN['focused'] if path.startswith('tests/')],
        'tests/fixtures/pe-bounds', 'tests/fixtures/pe-inspection', 'tests/fixtures/decompiler-cfg/native.json',
        'tests/managed-fixtures.js', 'planning/qualification/oracle-toolchain.json').splitlines())
    for name in paths or []:
        if '/reference/' not in name and '/qualification/' not in name:
            facts['files'][name] = inspect(name, lambda name=name: digest((ROOT / name).read_bytes()))
    aliases = ROOT / 'node_modules/@sharpforge'
    names = inspect('alias roster', lambda: sorted(set(PLAN['baselinePreparation']['publicAliases']) |
                                                  {path.name for path in aliases.iterdir()}))
    for name in names or []:
        target = inspect('alias ' + name, lambda name=name: str((aliases / name).resolve(strict=True)))
        expected = str(ROOT / 'packages' / name)
        facts['aliases'][name] = {'target': target, 'expected': expected, 'owned': target == expected}
    return facts


def snapshot_admitted(facts):
    assert not facts['inspectionErrors'], 'Source inspection failed; retain actual partial facts'
    assert facts['head'] == EXPECTED_HEAD, 'Exact operator-reviewed source HEAD required'
    assert facts['productChangedPaths'] == [], 'Frozen product source changed'
    assert all(row['owned'] for row in facts['aliases'].values()), 'Foreign or missing package alias'


def source_identity(facts):
    # Retaining new reference files deliberately changes Git status; preserve status separately.
    return {key: facts[key] for key in ['head', 'tree', 'files', 'aliases', 'productChangedPaths']}


record = {'step': STEP, 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'planSha256': digest(PLAN_BYTES), 'recorderSha256': digest(Path(__file__).read_bytes()),
          'cwd': str(ROOT), 'expectedHead': EXPECTED_HEAD, 'status': 'running', 'exitCode': None, 'signal': None,
          'interruptions': [], 'inspectionErrors': [], 'outputs': []}
with RECEIPT.open('x') as stream:
    json.dump(record, stream, indent=2)
    stream.write('\n')
active = None
interrupted_at = None
outputs = []
primary = None


def interrupt(signum, _frame):
    global interrupted_at
    record['interruptions'].append({'signal': signum, 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    interrupted_at = interrupted_at or time.monotonic()
    if active is not None and active.poll() is None:
        active.send_signal(signal.SIGTERM)


def reap():
    while True:
        try:
            return active.wait(timeout=1)
        except subprocess.TimeoutExpired:
            if interrupted_at is not None and time.monotonic() - interrupted_at >= 10:
                # Give limited.js and the Node recorder time to forward abort, reap and flush first.
                record['forcedTermination'] = True
                try:
                    if os.name == 'posix':
                        os.killpg(active.pid, signal.SIGKILL)
                    else:
                        active.kill()
                except ProcessLookupError:
                    pass


handlers = {value: signal.signal(value, interrupt) for value in [signal.SIGINT, signal.SIGTERM]}
try:
    record['sourceBefore'] = snapshot()
    snapshot_admitted(record['sourceBefore'])
    record['availableDiskBefore'] = shutil.disk_usage(ROOT).free
    for previous in STEPS[:STEPS.index(STEP)]:
        prior = json.loads((DESTINATION / (previous + '.execution.json')).read_text())
        assert prior['status'] == 'passed' and prior['exitCode'] == 0 and prior['signal'] is None
    environment = dict(os.environ)
    for key, value in PLAN['environment'].items():
        if value is None:
            environment.pop(key, None)
        else:
            environment[key] = value
    record['environment'] = {key: environment.get(key) for key in [*PLAN['environment'], 'NODE_OPTIONS']}
    if record['interruptions']:
        raise InterruptedError('Qualification interrupted before phase launch')
    if STEP == 'retain-native':
        target = ROOT / PLAN['retainedNative']
        assert not target.exists()
        target.mkdir()
        record['copy'] = []
        for name in PLAN['retainNative']['files']:
            destination = target / name
            outputs.append(destination)
            data = (Path(PLAN['nativeDirectory']) / name).read_bytes()
            with destination.open('xb') as stream:
                stream.write(data)
            assert destination.read_bytes() == data
            record['copy'].append({'path': name, 'bytes': len(data), 'sha256': digest(data)})
            if record['interruptions']:
                raise InterruptedError('Qualification interrupted during exclusive retention')
        record.update(exitCode=0, signal=None)
    else:
        name = {'verify-external': 'verifyExternal', 'verify-retained': 'verifyRetained'}.get(STEP, STEP)
        record['argv'] = PLAN[name]
        stdout = DESTINATION / (STEP + '.stdout.txt')
        stderr = DESTINATION / (STEP + '.stderr.txt')
        outputs.extend([stdout, stderr])
        with stdout.open('xb') as out, stderr.open('xb') as err:
            active = subprocess.Popen(record['argv'], cwd=ROOT, env=environment, stdout=out, stderr=err,
                                      start_new_session=os.name == 'posix')
            if record['interruptions']:
                active.send_signal(signal.SIGTERM)
            returncode = reap()
        record['exitCode'] = returncode if returncode >= 0 else None
        record['signal'] = -returncode if returncode < 0 else None
    assert not record['interruptions'], 'Qualification interrupted; retained partial evidence is not a pass'
    assert record['exitCode'] == 0 and record['signal'] is None, 'Phase failed; stop before retry or edits'
except BaseException as error:
    primary = error
    record['failure'] = failure(error)
finally:
    if active is not None and active.poll() is None:
        try:
            interrupt(signal.SIGTERM, None)
            returncode = reap()
            record['exitCode'] = returncode if returncode >= 0 else None
            record['signal'] = -returncode if returncode < 0 else None
        except BaseException as error:
            record['inspectionErrors'].append({'inspection': 'child reaping', **failure(error)})
    try:
        record['sourceAfter'] = snapshot()
        record['inspectionErrors'].extend({'phase': 'after', **error} for error in record['sourceAfter']['inspectionErrors'])
        record['sourcesUnchanged'] = ('sourceBefore' in record and
            source_identity(record['sourceBefore']) == source_identity(record['sourceAfter']))
        snapshot_admitted(record['sourceAfter'])
        assert record['sourcesUnchanged'], 'Source drift during phase; actual before/after facts retained'
    except BaseException as error:
        record['inspectionErrors'].append({'inspection': 'source after', **failure(error)})
    for path in outputs:
        try:
            data = path.read_bytes()
            record['outputs'].append({'path': str(path), 'bytes': len(data), 'sha256': digest(data)})
        except BaseException as error:
            record['inspectionErrors'].append({'inspection': str(path), **failure(error)})
    try:
        record['availableDiskAfter'] = shutil.disk_usage(ROOT).free
    except BaseException as error:
        record['inspectionErrors'].append({'inspection': 'disk after', **failure(error)})
    if primary is None and record['interruptions']:
        primary = InterruptedError('Qualification interrupted during evidence finalization')
        record['failure'] = failure(primary)
    if primary is None and record['inspectionErrors']:
        primary = RuntimeError('Qualification evidence inspection failed; see retained inspectionErrors')
        record['failure'] = failure(primary)
    record['status'] = 'failed' if primary is not None else 'passed'
    record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with RECEIPT.open('w') as output:
        json.dump(record, output, indent=2)
        output.write('\n')
    for value, handler in handlers.items():
        signal.signal(value, handler)
    # Completion is decided after restoring handlers and checking signals handled during the final write.
    if primary is None and record['interruptions']:
        primary = InterruptedError('Qualification interrupted during final receipt write')
        record['failure'] = failure(primary)
        record['status'] = 'failed'
        record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with RECEIPT.open('w') as output:
            json.dump(record, output, indent=2)
            output.write('\n')
    print(json.dumps({key: value for key, value in record.items() if key not in ['sourceBefore', 'sourceAfter']}))
if primary is not None:
    raise primary
