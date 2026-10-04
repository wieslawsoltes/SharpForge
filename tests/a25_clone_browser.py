"""Qualify canonical public/private Clone Repository flows in the built Studio using native Git HTTP."""
from collections import deque
from importlib.metadata import version
from pathlib import Path
import hashlib
import json
import os
import platform
import queue
import subprocess
import sys
import threading
import time
import traceback

from playwright.sync_api import sync_playwright
from conformance.browser.launch import launch_browser, results_dir
from a25_clone_workflow import CloneWorkflow


ROOT = Path(__file__).resolve().parents[1]


class CloneFixture:
    def __init__(self):
        self.lines = queue.Queue()
        self.errors = deque(maxlen=40)
        self.transport_diagnostics = []
        self.process = subprocess.Popen(
            [os.environ.get('CODEX_PRIMARY_RUNTIME_NODE') or 'node', 'tests/fixtures/a25-clone-server.mjs'],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8'
        )

        def output():
            for line in self.process.stdout:
                self.lines.put(line)
            self.lines.put(None)

        def errors():
            for line in self.process.stderr:
                self.errors.append(line.rstrip())

        threading.Thread(target=output, daemon=True).start()
        threading.Thread(target=errors, daemon=True).start()
        try:
            self.metadata = self.read('ready', timeout=60)
        except BaseException:
            self.close()
            raise

    def read(self, expected, timeout=10):
        try:
            line = self.lines.get(timeout=timeout)
        except queue.Empty as error:
            raise RuntimeError('Native clone fixture response timed out: ' + '\n'.join(self.errors)) from error
        if line is None:
            raise RuntimeError('Native clone fixture stopped: ' + '\n'.join(self.errors))
        result = json.loads(line)
        if result.get('type') != expected:
            raise RuntimeError('Unexpected native clone fixture response: ' + repr(result))
        return result

    def requests(self):
        self.process.stdin.write('{"action":"observations"}\n')
        self.process.stdin.flush()
        result = self.read('observations')
        self.transport_diagnostics = result.get('diagnostics', [])
        return result['requests']

    def close(self):
        if self.process.poll() is not None:
            return
        try:
            self.process.stdin.write('{"action":"close"}\n')
            self.process.stdin.flush()
            self.process.wait(timeout=10)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)


def run(report, directory):
    if os.environ.get('SHARPFORGE_IN_MEMORY') == '1':
        raise RuntimeError('Canonical clone qualification requires built Studio, native workers and native HTTPS Git')
    for path in ['dist/index.html', 'dist/git-worker.js', 'dist/git-clone-dialog.js']:
        artifact = ROOT / path
        if not artifact.is_file():
            raise RuntimeError('Build the completed Studio scope before clone qualification: missing ' + path)
        report.setdefault('builtArtifacts', {})[path] = hashlib.sha256(artifact.read_bytes()).hexdigest()
    fixture = CloneFixture()
    try:
        report['native'] = fixture.metadata
        with sync_playwright() as playwright, launch_browser(playwright, __file__) as browser:
            report['environment'].update({'engine': browser.engine, 'browser': browser.version, 'playwright': version('playwright')})
            workflow = CloneWorkflow(browser, fixture, report, directory)
            for name, operation in [('public-canonical-clone', workflow.public_clone),
                                    ('private-authentication-retry', workflow.private_clone),
                                    ('declined-origin-grant', workflow.declined_grant)]:
                browser.check_cancelled()
                started = time.monotonic()
                row = {'name': name, 'passed': False}
                report['checks'].append(row)
                print(json.dumps({'case': name, 'state': 'running'}), flush=True)
                try:
                    row['result'] = operation()
                    row['passed'] = True
                except BaseException:
                    row['error'] = traceback.format_exc()
                    raise
                finally:
                    row['elapsedMs'] = (time.monotonic() - started) * 1000
                    report['cspViolations'] = list(browser.csp.events)
                    (directory / 'qualification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
                print(json.dumps({'case': name, 'state': 'passed'}), flush=True)
            report['cspViolations'] = browser.csp.events
            browser.csp.assert_clean()
    finally:
        try:
            report['requests'] = fixture.requests()
            report['transportDiagnostics'] = fixture.transport_diagnostics
        except Exception as error:
            report.setdefault('diagnosticErrors', []).append('Native request observations: ' + str(error))
        finally:
            fixture.close()
            report['serverDiagnostics'] = list(fixture.errors)


def main():
    directory = results_dir() / 'a25_clone_browser'
    directory.mkdir(parents=True, exist_ok=True)
    report = {'schemaVersion': 1, 'suite': 'SF-A25-T08.12 native Studio clone', 'passed': False,
              'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'environment': {'python': platform.python_version(), 'platform': platform.platform()},
              'mode': 'built Studio with native workers/IndexedDB, real git-http-backend, explicit loopback HTTPS/CORS',
              'tls': 'Existing public loopback test certificate; only isolated fixture contexts ignore its trust error',
              'checks': [], 'observations': []}
    try:
        run(report, directory)
        report['passed'] = True
    except BaseException:
        report['failure'] = traceback.format_exc()
        traceback.print_exc()
    finally:
        report['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        (directory / 'qualification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'evidence': str(directory / 'qualification.json')}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
