"""Execute one explicitly authorized method-header qualification step and retain its evidence."""

import datetime
import hashlib
import json
import math
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


ROOT = Path('/workspace/scratch/7e3d2a445c44')
PLAN = ROOT / 'method-header-preflight-c0e3352e-v2.json'
PLAN_SHA256 = 'eb152c11829e651c66d7f15c0790cc4458692888d203dbc302d1a8891c6e5252'


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def file_record(path):
    path = Path(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha256(path)}


def git(checkout, *args):
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args],
                                   cwd=checkout, env=environment).decode().strip()


def snapshot(plan):
    state = {'checkouts': {}, 'tools': []}
    for side, expected in plan['checkouts'].items():
        checkout = Path(expected['path'])
        entry = {'head': git(checkout, 'rev-parse', 'HEAD'),
                 'tree': git(checkout, 'rev-parse', 'HEAD^{tree}'),
                 'trackedChanges': git(checkout, 'status', '--porcelain', '--untracked-files=no'),
                 'untrackedNonignored': git(checkout, 'ls-files', '--others', '--exclude-standard'),
                 'aliases': [], 'files': []}
        for alias in expected['aliases']:
            path = checkout / 'node_modules/@sharpforge' / alias['name']
            assert path.is_symlink(), str(path)
            entry['aliases'].append({'name': alias['name'], 'target': os.readlink(path),
                                     'resolved': str(path.resolve(strict=True))})
        present = sorted(path.name for path in (checkout / 'node_modules/@sharpforge').iterdir())
        assert present == sorted(alias['name'] for alias in expected['aliases'])
        for source in expected['files']:
            path = checkout / source['path']
            entry['files'].append({'path': source['path'], 'bytes': path.stat().st_size, 'sha256': sha256(path)})
        state['checkouts'][side] = entry
    for tool in plan['toolFiles']:
        state['tools'].append(file_record(tool['path']))
    return state


def verify_snapshot(plan, state):
    for side, expected in plan['checkouts'].items():
        actual = state['checkouts'][side]
        assert actual['head'] == expected['head'] and actual['tree'] == expected['tree'], side
        assert not actual['trackedChanges'] and not actual['untrackedNonignored'], side
        assert actual['aliases'] == expected['aliases'], side
        assert actual['files'] == expected['files'], side
    assert state['tools'] == plan['toolFiles'], 'Tool or runtime bytes changed'
    for original in plan['immutablePreparationFiles']:
        assert file_record(original['path']) == original, original['path']


def inventory(directory):
    directory = Path(directory)
    if not directory.exists():
        return []
    if directory.is_file():
        return [file_record(directory)]
    results = []
    for path in sorted(directory.rglob('*')):
        assert not path.is_symlink(), f'Unexpected output symlink: {path}'
        if path.is_file():
            results.append(file_record(path))
    return results


def verify_header_capture(step):
    directory = Path(step['output'])
    report = json.loads((directory / 'capture.json').read_text())
    assert report['qualified'] is True and 'failure' not in report
    assert len(report['commands']) == 11, 'Four pinned probes plus seven workload commands are required'
    assert list(report['observations']) == ['roslyn', 'compiler', 'ilasm', 'body-writer']
    for command in report['commands']:
        assert command['status'] == 'exited' and command['exitCode'] == 0 and command['signal'] is None
        assert command['startedAt'] and command['finishedAt'] and command['cwd']
        for stream in ['stdout', 'stderr']:
            log = command['logs'][stream]
            content = (directory / log['path']).read_bytes()
            assert content == command[stream].encode('utf-8')
            assert len(content) == log['bytes'] and hashlib.sha256(content).hexdigest() == log['sha256']
    return {'subprocesses': len(report['commands']), 'observations': list(report['observations']),
            'nativeToolchain': report['toolchain'], 'captureSha256': sha256(directory / 'capture.json')}


def verify_benchmark(plan, step):
    report = json.loads(Path(step['output']).read_text())
    expected = step['benchmark']
    assert report['qualified'] is True and 'failure' not in report and report['gcExposed'] is True
    for name in ['compilerRevision', 'headerMode', 'workload', 'compilerEntry', 'driverSHA256', 'sourceSHA256']:
        assert report[name] == expected[name], name
    assert len(report['samplesMs']) == 121 and len(report['heapUsedDeltas']) == 121
    assert all(math.isfinite(value) and value >= 0 for value in report['samplesMs'])
    assert all(math.isfinite(value) for value in report['heapUsedDeltas'])
    samples = sorted(report['samplesMs'][21:])
    assert report['firstCompileMs'] == report['samplesMs'][0]
    assert report['medianMs'] == (samples[49] + samples[50]) / 2
    assert report['p95Ms'] == samples[94] and report['p99Ms'] == samples[98]
    assert report['firstCompilations'] == 1 and report['warmupCompilations'] == 20
    assert report['measuredCompilations'] == 100
    return {name: report[name] for name in ['workload', 'headerMode', 'compilerImportMs', 'firstCompileMs',
            'medianMs', 'p95Ms', 'p99Ms', 'assemblyBytes', 'assemblySHA256', 'gcExposed']}


def parse_test_summary(stdout):
    required = {'tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'}
    counters, markers = {}, set()
    pattern = re.compile(r'(#|ℹ) +(tests|suites|pass|fail|cancelled|skipped|todo) +(.+)')
    for line in Path(stdout).read_text().splitlines():
        match = pattern.fullmatch(line)
        if match is None:
            continue
        marker, name, value = match.groups()
        assert name not in counters, f'Duplicate test counter: {name}'
        assert re.fullmatch(r'[0-9]+', value), f'Invalid test counter: {name}'
        markers.add(marker)
        counters[name] = int(value)
    assert set(counters) == required, 'Incomplete test counter set'
    assert len(markers) == 1, 'Mixed TAP/spec test counters'
    assert counters['tests'] > 0 and counters['pass'] == counters['tests'], 'Tests did not all pass'
    assert all(counters[name] == 0 for name in ['fail', 'cancelled', 'skipped', 'todo']), 'Unsuccessful test counters'
    return {'reporter': 'tap' if markers == {'#'} else 'node-spec', **counters}


def verify_adjudicated_prerequisite(prerequisite):
    assert prerequisite['kind'] == 'successful-test-with-failed-recorder'
    proof = prerequisite['evidence']
    assert file_record(proof['path']) == proof, 'Adjudication changed'
    adjudication = json.loads(Path(proof['path']).read_text())
    assert adjudication['disposition'] == 'test-passed-recorder-failed'
    assert adjudication['testWasRerun'] is False and adjudication['originalRecorderOutcomeChanged'] is False
    assert adjudication['originalRecorderStatus'] == 'failed' and adjudication['actualTestProcessExitCode'] == 0
    assert adjudication['sourcesAndToolsUnchanged'] is True
    for evidence in adjudication['evidenceFiles']:
        assert file_record(evidence['path']) == evidence, evidence['path']
    stdout = next(item['path'] for item in adjudication['evidenceFiles'] if Path(item['path']).name == 'stdout.log')
    assert parse_test_summary(stdout) == adjudication['actualTestResult']


def verify_result(plan, step, stdout):
    if step['id'] == 'native':
        return verify_header_capture(step)
    if step['id'] == 'refout':
        report = json.loads((Path(step['output']) / 'reference.json').read_text())
        assert report['sdk'] == '10.0.201' and report['referencePack'] == '10.0.5'
        assert [case['id'] for case in report['cases']] == ['public', 'friend']
        assert all(case['consumerCompiled'] for case in report['cases'])
        return {'cases': len(report['cases']), 'sdk': report['sdk'], 'runtime': report['runtime'],
                'provenanceLimit': plan['refoutProvenanceLimit']}
    if 'benchmark' in step:
        return verify_benchmark(plan, step)
    return parse_test_summary(stdout)


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    except ProcessLookupError:
        process.wait()


def main():
    assert sha256(PLAN) == PLAN_SHA256, 'Reviewed execution plan changed'
    plan = json.loads(PLAN.read_text())
    assert len(sys.argv) == 2 and sys.argv[1] in plan['steps'], 'Pass exactly one prepared step ID'
    step = plan['steps'][sys.argv[1]]
    directory = Path(plan['executionDirectory'])
    directory.mkdir(exist_ok=True)
    step_directory = directory / 'steps' / step['id']
    step_directory.mkdir(parents=True)
    record_path = step_directory / 'execution.json'
    stdout_path, stderr_path = step_directory / 'stdout.log', step_directory / 'stderr.log'
    record = {'step': step['id'], 'status': 'preflight', 'argv': step['argv'], 'cwd': step['cwd'],
              'originalArgv': step['originalArgv'], 'planSha256': PLAN_SHA256,
              'recorderSha256': sha256(__file__), 'preflightStartedAt': utc(), 'qualification': 'not-started'}
    save(record_path, record)
    lock_path = directory / 'execution.lock'
    lock_acquired = False
    process = None
    try:
        with lock_path.open('x') as lock:
            lock.write(json.dumps({'pid': os.getpid(), 'step': step['id'], 'startedAt': utc()}) + '\n')
        lock_acquired = True
        for dependency in step['after']:
            if dependency in plan.get('adjudicatedPrerequisites', {}):
                verify_adjudicated_prerequisite(plan['adjudicatedPrerequisites'][dependency])
            else:
                previous = directory / 'steps' / dependency / 'execution.json'
                assert json.loads(previous.read_text())['status'] == 'passed', dependency
        assert shutil.disk_usage(ROOT).free >= step['minimumFreeBytes'], 'Insufficient free disk for the prepared step'
        if step.get('output'):
            output = Path(step['output'])
            assert not output.exists() and not output.is_symlink(), 'Fresh output required'
            output.parent.mkdir(parents=True, exist_ok=True)
        before = snapshot(plan)
        save(step_directory / 'source-before.json', before)
        record['sourceBefore'] = file_record(step_directory / 'source-before.json')
        verify_snapshot(plan, before)
        environment = dict(os.environ)
        environment.update(plan['environment'])
        assert not environment.get('CI') and not environment.get('GITHUB_ACTIONS')
        assert environment.get('NODE_OPTIONS') in [None, '', '--max-old-space-size=2048'], 'Unexpected Node startup flags'
        assert str(Path(shutil.which('node', path=environment['PATH'])).resolve()) == plan['nodeExecutable']
        record.update(status='running', qualification='running', startedAt=utc(), timeoutSeconds=step['timeoutSeconds'],
                      availableDiskBytesBefore=shutil.disk_usage(ROOT).free,
                      environment={name: environment.get(name) for name in plan['publicEnvironmentNames']},
                      environmentScope='Public execution settings only; unlisted inherited variables are not serialized.')
        save(record_path, record)
        start = time.monotonic()
        with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
            process = subprocess.Popen(step['argv'], cwd=step['cwd'], env=environment, stdout=stdout,
                                       stderr=stderr, start_new_session=True)
            record['pid'] = process.pid
            save(record_path, record)
            try:
                exit_code = process.wait(timeout=step['timeoutSeconds'])
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                stop(process)
                raise
        record.update(exitCode=exit_code, signal=(-exit_code if exit_code < 0 else None),
                      elapsedSeconds=time.monotonic() - start, finishedAt=utc(),
                      availableDiskBytesAfter=shutil.disk_usage(ROOT).free)
        assert exit_code == 0, f'Prepared command exited {exit_code}; preserve this attempt and stop'
        record['resultSummary'] = verify_result(plan, step, stdout_path)
        record['status'] = 'passed'
        record['qualification'] = 'passed-for-this-step-only'
    except BaseException as error:
        if process is not None and process.poll() is None:
            stop(process)
        record.update(status='failed', qualification='failed', finishedAt=utc(),
                      failure={'type': type(error).__name__, 'message': str(error)})
        if process is not None:
            record['exitCode'] = process.returncode
            record['signal'] = -process.returncode if process.returncode is not None and process.returncode < 0 else None
        if 'start' in locals():
            record['elapsedSeconds'] = time.monotonic() - start
    finally:
        record['outerLogs'] = []
        record['outputInventory'] = []
        try:
            record['outerLogs'] = [file_record(path) for path in [stdout_path, stderr_path] if path.exists()]
            record['outputInventory'] = inventory(step['output']) if step.get('output') else []
        except Exception as error:
            record.update(status='failed', qualification='failed', outputVerificationError=str(error))
        try:
            after = snapshot(plan)
            save(step_directory / 'source-after.json', after)
            record['sourceAfter'] = file_record(step_directory / 'source-after.json')
            verify_snapshot(plan, after)
            record['sourcesAndToolsUnchanged'] = 'before' in locals() and before == after
            assert record['sourcesAndToolsUnchanged'], 'Source, fixture, alias, or tool changed'
        except Exception as error:
            record.update(status='failed', qualification='failed', sourceVerificationError=str(error))
        record['recordFinishedAt'] = utc()
        save(record_path, record)
        if lock_acquired:
            lock_path.unlink()
    print(json.dumps({key: record.get(key) for key in ['step', 'status', 'exitCode', 'startedAt', 'finishedAt',
          'elapsedSeconds', 'resultSummary', 'failure', 'sourceVerificationError', 'sourcesAndToolsUnchanged']}, indent=2))
    print(json.dumps({'record': file_record(record_path), 'outerLogs': record['outerLogs'],
                      'outputFiles': len(record['outputInventory'])}, indent=2))
    return 0 if record['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
