"""Execute the reviewed two-command integration gate once; retain every failure and raw stream."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def identity(path):
    path = Path(path)
    before = path.stat()
    assert path.is_file() and before.st_size <= 256 * 1024 * 1024, 'Invalid evidence file'
    hashed = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            assert size <= 256 * 1024 * 1024, 'Evidence grew beyond bound'
            hashed.update(chunk)
    assert size == before.st_size, 'Evidence changed while hashing'
    return {'path': str(path), 'bytes': size, 'sha256': hashed.hexdigest()}


def error_fact(error):
    return {'type': type(error).__name__, 'message': str(error)}


def main():
    assert len(sys.argv) == 4, 'Pass absolute plan path and frozen plan SHA-256'
    plan_path = Path(sys.argv[1])
    assert plan_path.is_absolute() and sys.argv[3] == 'run-two-focused-commands-once'
    plan_bytes = plan_path.read_bytes()
    assert hashlib.sha256(plan_bytes).hexdigest() == sys.argv[2], 'Plan hash mismatch'
    plan = json.loads(plan_bytes)
    assert plan['format'] == 'sharpforge.method-header.integration-source-review-plan'
    assert plan['version'] == 1 and [row['id'] for row in plan['commands']] == ['focused-original', 'focused-synthesized']
    own = identity(Path(__file__).resolve())
    assert own == plan['recorder'], 'Recorder identity changed'
    root = Path(plan['candidate']['path'])
    directory = Path(plan['admissionAndRetention']['executionDirectory'])
    assert not directory.exists() and not directory.is_symlink(), 'Fresh output directory required'
    directory.mkdir()
    receipt = directory / 'recorder.execution.json'
    record = {'status': 'preflight', 'startedUtc': utc(), 'argv': sys.argv,
              'plan': identity(plan_path), 'recorder': own, 'candidate': plan['candidate'],
              'commands': [], 'interruptions': [], 'secondaryErrors': [], 'saveAttempts': [], 'failure': None}
    active = None
    interrupted_at = None
    primary = None
    save_number = 0

    def fail(error, stage):
        nonlocal primary
        detail = {'stage': stage, 'utc': utc(), **error_fact(error)}
        if primary is None:
            primary = error
            record['failure'] = detail
        else:
            record['secondaryErrors'].append(detail)
        record['status'] = 'failed'

    def save(stage):
        nonlocal save_number
        save_number += 1
        pending = directory / ('receipt.pending-%03d.json' % save_number)
        record['saveAttempts'].append({'stage': stage, 'path': str(pending), 'utc': utc()})
        try:
            with pending.open('x') as stream:
                json.dump(record, stream, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, receipt)
            return True
        except BaseException as error:
            fail(error, 'save:' + stage)
            return False

    def interrupt(signum, _frame):
        nonlocal interrupted_at
        record['interruptions'].append({'signal': signum, 'utc': utc()})
        interrupted_at = interrupted_at or time.monotonic()
        fail(InterruptedError('Qualification interrupted by signal ' + str(signum)), 'signal')
        if active is not None and active.poll() is None:
            try:
                active.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass

    def git(*arguments):
        return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *arguments], cwd=root,
                                       env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, stderr=subprocess.PIPE)

    def snapshot():
        facts = {'head': git('rev-parse', 'HEAD').decode().strip(),
                 'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
                 'status': git('status', '--porcelain=v1', '--untracked-files=all').decode(),
                 'packages': [], 'focusedFiles': [], 'node': identity(plan['node']['path'])}
        assert facts['head'] == plan['candidate']['head'] and facts['tree'] == plan['candidate']['tree']
        assert facts['status'] == '', 'Checkout changed'
        assert str(Path(shutil.which('node')).resolve(strict=True)) == plan['node']['path']
        assert facts['node'] == plan['node'], 'Node executable changed'
        for package in plan['packages']:
            name = package['name']
            alias = Path(package['aliasPath'])
            assert alias.is_symlink() and os.readlink(alias) == package['aliasTarget']
            assert str(alias.resolve(strict=True)) == package['resolved'] == str(root / 'packages' / name)
            manifest = identity(root / 'packages' / name / 'package.json')
            assert manifest['sha256'] == package['manifestSha256'], 'Package manifest changed'
            expected_tree = git('rev-parse', 'HEAD:packages/' + name + '/src').decode().strip()
            assert expected_tree == package['sourceGitTree']
            roster = git('ls-tree', '-rz', 'HEAD', '--', 'packages/' + name + '/src').split(b'\0')
            entries = []
            for line in filter(None, roster):
                attributes, relative = line.split(b'\t', 1)
                mode, kind, expected_blob = attributes.decode().split()
                assert kind == 'blob' and mode in ['100644', '100755'], 'Unexpected package source entry'
                path = root / relative.decode()
                data = path.read_bytes()
                actual_blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
                assert actual_blob == expected_blob, 'Source bytes changed: ' + str(path)
                entries.append({'path': relative.decode(), 'bytes': len(data), 'gitBlob': actual_blob})
            facts['packages'].append({'name': name, 'manifest': manifest, 'sourceTree': expected_tree,
                                      'alias': str(alias.resolve()), 'sources': entries})
        for expected in plan['focusedSourceFiles']:
            actual = identity(root / expected['path'])
            assert actual['bytes'] == expected['bytes'] and actual['sha256'] == expected['sha256'], expected['path']
            facts['focusedFiles'].append(actual)
        pack = Path(plan['requiredReferencePack']['path'])
        versions = sorted(path.name for path in pack.parents[2].iterdir() if path.is_dir())
        assert versions == plan['requiredReferencePack']['availableVersions'], 'Reference-pack selection changed'
        references = [{'name': path.name, 'sha256': identity(path)['sha256']} for path in sorted(pack.glob('*.dll'))]
        assert len(references) == plan['requiredReferencePack']['files']
        packed = json.dumps(references, separators=(',', ':')).encode()
        assert hashlib.sha256(packed).hexdigest() == plan['requiredReferencePack']['aggregateSha256']
        facts['referencePack'] = {'path': str(pack), 'references': references}
        assert identity(plan_path) == record['plan'] and identity(Path(__file__).resolve()) == record['recorder']
        return facts

    def retain_json(path, value):
        with path.open('x') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
        return identity(path)

    def reap(deadline, command):
        stop_at = interrupted_at
        while active.poll() is None:
            now = time.monotonic()
            if now >= deadline and stop_at is None:
                fail(TimeoutError('Prepared focused command timed out'), command['id'])
                command['timedOut'] = True
                stop_at = now
                active.send_signal(signal.SIGTERM)
            stop_at = stop_at or interrupted_at
            if stop_at is not None and now - stop_at >= 10:
                command['forcedTermination'] = True
                try:
                    os.killpg(active.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                active.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                pass
        return active.returncode

    def inspect_result(step, stdout):
        text = stdout.read_text()
        counters = {name: int(value) for name, value in re.findall(
            r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', text, re.M)}
        assert all(name in counters for name in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'])
        assert counters['fail'] == counters['cancelled'] == counters['todo'] == 0
        assert not re.search(r'^not ok ', text, re.M), 'A test failed'
        if step['id'] == 'focused-original':
            assert counters['tests'] == counters['pass'] == 79 and counters['skipped'] == 0, counters
        else:
            results = re.findall(r'^ok \d+ - (.*)$', text, re.M)
            matched = []
            for expected in step['expected']['selectedNames']:
                present = [line for line in results if line == expected or line.startswith(expected + ' #')]
                assert present == [expected], 'Selected test absent, repeated or skipped: ' + expected
                matched.append(expected)
            assert counters['pass'] == 5, counters
            allowed = set(step['expected']['intentionalNonmatchingNames'])
            for line in results:
                if ' # SKIP' in line:
                    assert line.split(' # SKIP', 1)[0] in allowed, 'Unexpected test skip'
            counters['selectedNames'] = matched
        return counters

    handlers = {value: signal.signal(value, interrupt) for value in [signal.SIGINT, signal.SIGTERM]}
    try:
        if not save('initial') or primary is not None:
            pass
        else:
            environment = {**os.environ, **plan['environment']}
            assert not environment.get('CI') and not environment.get('GITHUB_ACTIONS')
            assert environment.get('NODE_OPTIONS') in [None, '']
            record['environment'] = {key: environment.get(key) for key in plan['environmentAdmission']['publicRecorded']}
            for step in plan['commands']:
                if primary is not None:
                    break
                command = {'id': step['id'], 'argv': step['argv'], 'cwd': step['cwd'], 'status': 'preflight',
                           'startedUtc': utc(), 'exitCode': None, 'signal': None, 'outputs': []}
                record['commands'].append(command)
                before = None
                try:
                    command['availableDiskBefore'] = shutil.disk_usage(root).free
                    assert command['availableDiskBefore'] >= plan['admissionAndRetention']['minimumFreeBytes']
                    before = snapshot()
                    command['sourceBefore'] = retain_json(directory / (step['id'] + '.source-before.json'), before)
                    if not save(step['id'] + ':admitted') or primary is not None:
                        break
                    stdout, stderr = Path(step['stdout']), Path(step['stderr'])
                    with stdout.open('xb') as out, stderr.open('xb') as err:
                        command['status'] = 'running'
                        if not save(step['id'] + ':before-launch') or primary is not None:
                            break
                        active = subprocess.Popen(step['argv'], cwd=step['cwd'], env=environment,
                                                  stdout=out, stderr=err, start_new_session=True)
                        command['pid'] = active.pid
                        if not save(step['id'] + ':launched') or primary is not None:
                            active.send_signal(signal.SIGTERM)
                            if interrupted_at is None:
                                interrupted_at = time.monotonic()
                        code = reap(time.monotonic() + step['timeoutSeconds'], command)
                    command['exitCode'] = code if code >= 0 else None
                    command['signal'] = -code if code < 0 else None
                    assert primary is None and not record['interruptions'], 'Interrupted or failed recorder'
                    assert code == 0, 'Prepared command exited ' + str(code)
                    command['result'] = inspect_result(step, stdout)
                except BaseException as error:
                    fail(error, step['id'])
                finally:
                    try:
                        if active is not None and active.poll() is None:
                            try:
                                active.send_signal(signal.SIGTERM)
                            except ProcessLookupError:
                                pass
                            interrupted_at = interrupted_at or time.monotonic()
                            code = reap(time.monotonic(), command)
                            command['exitCode'] = code if code >= 0 else None
                            command['signal'] = -code if code < 0 else None
                    except BaseException as error:
                        fail(error, step['id'] + ':child-reaping')
                    active = None
                    for name in [step['stdout'], step['stderr']]:
                        try:
                            if Path(name).exists():
                                command['outputs'].append(identity(name))
                        except BaseException as error:
                            fail(error, step['id'] + ':output-inspection')
                    try:
                        after = snapshot()
                        command['sourceAfter'] = retain_json(directory / (step['id'] + '.source-after.json'), after)
                        assert before is not None and before == after, 'Source/alias/tool drift'
                    except BaseException as error:
                        fail(error, step['id'] + ':source-after')
                    command['status'] = 'failed' if primary is not None else 'passed'
                    command['finishedUtc'] = utc()
                    if not save(step['id'] + ':finished'):
                        command['status'] = 'failed'
                    try:
                        command['receipt'] = retain_json(Path(step['receipt']), command)
                    except BaseException as error:
                        fail(error, step['id'] + ':command-receipt')
                    save(step['id'] + ':receipt-retained')
    except BaseException as error:
        fail(error, 'outer')
    finally:
        record['status'] = 'passed' if primary is None and len(record['commands']) == 2 else 'failed'
        record['finishedUtc'] = utc()
        saved = save('final')
        # Interrupts during final I/O remain failures; restore handlers before deciding completion.
        for value, handler in handlers.items():
            signal.signal(value, handler)
        if not saved or primary is not None or record['interruptions']:
            record['status'] = 'failed'
            record['finishedUtc'] = utc()
            save('final-failure')
            try:
                retain_json(directory / 'recorder.failure.json', record)
            except BaseException as error:
                fail(error, 'failure-sidecar')
        # The full in-memory record remains on stderr if final persistent writing failed.
        if record['status'] != 'passed':
            print(json.dumps(record), file=sys.stderr)
        print(json.dumps({'status': record['status'], 'receipt': str(receipt), 'failure': record['failure'],
                          'secondaryErrors': record['secondaryErrors'], 'commands': record['commands']}))
    return 0 if record['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({'status': 'failed-before-admission', 'failure': error_fact(error), 'argv': sys.argv}), file=sys.stderr)
        raise
