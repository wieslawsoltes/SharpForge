"""Serial, bounded safety command execution with explicit libtest evidence."""
import os
import re
import selectors
import signal
import subprocess
import time

MAX_OUTPUT_BYTES = 4 * 1024 * 1024
TEST_RESULT = re.compile(
    r'test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out')


def command_environment(overrides):
    environment = dict(os.environ)
    for key in list(environment):
        if key.startswith(('MIRI', 'LOOM_', 'CARGO_ENCODED_', 'CARGO_BUILD_RUST', 'CARGO_TARGET_')) or key in (
                'RUSTFLAGS', 'RUSTDOCFLAGS', 'RUSTC', 'RUSTDOC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER',
                'ASAN_OPTIONS', 'TSAN_OPTIONS', 'LSAN_OPTIONS'):
            environment.pop(key)
    environment.update(overrides)
    return environment


def run_command(command, root, timeout):
    """Retain up to 4 MiB output; kill the process group on bound/cancellation."""
    started = time.monotonic()
    output, error = bytearray(), None
    with subprocess.Popen(command['argv'], cwd=root, env=command_environment(command['env']),
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True) as process:
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        error = 'timeout'
                        break
                    for key, _ in selector.select(min(remaining, 0.25)):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        elif len(output) + len(chunk) > MAX_OUTPUT_BYTES:
                            error = 'output limit exceeded'
                            break
                        else:
                            output.extend(chunk)
                    if error:
                        break
            if not error:
                process.wait(timeout=max(0.01, timeout - (time.monotonic() - started)))
        except subprocess.TimeoutExpired:
            error = 'timeout'
        except KeyboardInterrupt:
            error = 'cancelled'
        finally:
            if error or process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
    return {'argv': command['argv'], 'env': command['env'], 'exitCode': process.returncode,
            'output': output.decode('utf-8', errors='replace'), 'error': error,
            'seconds': time.monotonic() - started}


def test_evidence(output):
    summaries = [[int(value) for value in row] for row in TEST_RESULT.findall(output)]
    passed = sum(row[0] for row in summaries)
    complete = bool(summaries) and passed > 0 and all(not any(row[1:]) for row in summaries)
    return {'passed': passed, 'summaries': len(summaries), 'complete': complete}


def execute(root, report, timeout, runner=run_command):
    if report['status'] != 'planned':
        return report
    for command in report['commands']:
        try:
            row = runner(command, root, timeout)
        except OSError as error:
            row = {'argv': command['argv'], 'exitCode': None, 'error': str(error), 'output': ''}
        report['results'].append(row)
        if row['exitCode'] != 0 or row.get('error'):
            report.update(status='failed', qualified=False)
            return report
        if command['requiresTests']:
            row['tests'] = test_evidence(row['output'])
            if not row['tests']['complete']:
                report.update(status='failed', qualified=False, reason='Nonempty, unfiltered, unignored libtest results required')
                return report
    report.update(status='passed', qualified=True)
    return report
