"""Run the prepared E01 static bundle in a real browser. Requires Python Playwright.

Preparation and execution are validation steps; run only after E01 is assembled.
No npm dependencies or changes to browser security policy are required.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def git(*arguments):
    return subprocess.check_output(['git', *arguments], cwd=ROOT)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=ROOT / 'artifacts/a05-e01-browser')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    parser.add_argument('--timeout', type=float, default=900)
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    report_path = (args.report or artifacts / ('results-' + args.browser + '.json')).resolve()
    report = {'schemaVersion': 1, 'passed': False, 'checks': [], 'errors': [], 'commands': [sys.executable, *sys.argv],
              'python': sys.version, 'platform': platform.platform(), 'architecture': platform.machine(),
              'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'artifacts': str(artifacts)}
    server = None
    try:
        if args.timeout <= 0:
            raise ValueError('--timeout must be positive')
        manifest = json.loads((artifacts / 'manifest.json').read_text())
        report['commit'] = git('rev-parse', 'HEAD').decode().strip()
        report['preparation'] = json.loads((artifacts / 'preparation.json').read_text())
        report['worktreeStatus'] = git('status', '--porcelain=v1').decode()
        report['trackedDiffSha256'] = digest(git('diff', '--binary', 'HEAD'))
        report['runtimeBundleSha256'] = digest((artifacts / 'a05-e01.bundle.js').read_bytes())
        report['suiteSha256'] = digest((ROOT / 'tests/browser_e01_suite.js').read_bytes())
        report['manifestSha256'] = digest((artifacts / 'manifest.json').read_bytes())
        report['nativeQualification'] = False
        report['assemblyInputs'] = [{key: value for key, value in item.items() if key not in ('base64', 'output')}
                                    for item in manifest['assemblies']]
        for key, actual in [('preparedCommit', report['commit']), ('trackedDiffSha256', report['trackedDiffSha256']),
                            ('runtimeBundleSha256', report['runtimeBundleSha256']), ('suiteSha256', report['suiteSha256'])]:
            if manifest.get(key) != actual:
                raise RuntimeError('Stale or modified browser preparation: ' + key + '. Re-run scripts/prepare-a05-browser.js.')
        from playwright.sync_api import sync_playwright
        report['playwright'] = importlib.metadata.version('playwright')
        handler = partial(QuietHandler, directory=str(artifacts))
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as playwright:
            launcher = getattr(playwright, args.browser)
            launch_options = {'headless': True}
            executable = os.environ.get('CHROMIUM_EXECUTABLE') if args.browser == 'chromium' else None
            if executable:
                launch_options['executable_path'] = executable
            if args.browser == 'chromium':
                launch_options['args'] = ['--no-sandbox']
            browser = launcher.launch(**launch_options)
            report['browser'] = {'name': args.browser, 'version': browser.version, 'executable': executable or 'Playwright managed'}
            page = browser.new_page()
            page.on('pageerror', lambda error: report['errors'].append({'kind': 'pageerror', 'message': str(error)}))
            page.on('console', lambda message: report['errors'].append({'kind': 'console', 'message': message.text}) if message.type == 'error' else None)
            page.on('requestfailed', lambda request: report['errors'].append({'kind': 'requestfailed', 'url': request.url, 'failure': request.failure}))
            page.goto('http://127.0.0.1:' + str(server.server_port) + '/', wait_until='load')
            deadline = time.monotonic() + args.timeout
            seen = 0
            while True:
                state = page.evaluate('(offset)=>({done:window.a05E01.done,checks:window.a05E01.checks.slice(offset),errors:window.a05E01.errors})', seen)
                for check in state['checks']:
                    report['checks'].append(check)
                    print(('PASS' if check['passed'] else 'FAIL'), check['engine'], check['name'], flush=True)
                    if not check['passed']:
                        print(json.dumps(check, indent=2), flush=True)
                seen += len(state['checks'])
                if state['done']:
                    report['errors'].extend(state['errors'])
                    result = page.evaluate('window.a05E01.result')
                    report['workerResult'] = result
                    report['passed'] = bool(result and result['passed'] and not report['errors'])
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError('Browser qualification exceeded ' + str(args.timeout) + ' seconds; partial checks are retained')
                page.wait_for_timeout(100)
            browser.close()
    except Exception as error:
        report['errors'].append({'kind': 'harness', 'name': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()})
        traceback.print_exc()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        report['completedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        report['passedChecks'] = sum(bool(check['passed']) for check in report['checks'])
        report['failedChecks'] = sum(not check['passed'] for check in report['checks'])
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'passed': report['passed'], 'passedChecks': report['passedChecks'],
                          'failedChecks': report['failedChecks'], 'errors': len(report['errors']), 'report': str(report_path)}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
