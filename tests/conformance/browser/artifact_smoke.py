"""Real Chromium negative/cancellation qualification; no fixture browser."""
from pathlib import Path
import json
import os
import subprocess
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
from conformance.browser.launch import launch_browser, results_dir
from conformance.browser.run_suite import cancel


def child(mode):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p, launch_browser(p, mode) as browser:
        page = browser.new_page()
        page.set_content('<h1>Diagnostic artifact regression</h1>')
        page.evaluate('console.error("intentional artifact smoke failure")')
        (results_dir() / 'ready').write_text('ready', encoding='utf8')
        if mode == 'failure':
            raise AssertionError('intentional artifact smoke failure')
        while True:
            page.wait_for_timeout(100)


def verify():
    reports = []
    for mode in ('failure', 'cancel', 'cancel-file'):
        directory = results_dir() / ('artifact-smoke-' + mode)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / 'ready').unlink(missing_ok=True)
        cancel_file = directory / 'cancel.request' if mode == 'cancel-file' or (mode == 'cancel' and os.name == 'nt') else None
        if cancel_file:
            cancel_file.unlink(missing_ok=True)
        with (directory / 'process.log').open('w', encoding='utf8') as log:
            process = subprocess.Popen([sys.executable, __file__, mode], cwd=ROOT,
                env={**os.environ, 'SHARPFORGE_RESULTS_DIR': str(directory), **({'SHARPFORGE_CANCEL_FILE': str(cancel_file)} if cancel_file else {})},
                stdout=log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
            try:
                if mode.startswith('cancel'):
                    deadline = time.monotonic() + 30
                    while not (directory / 'ready').exists():
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise AssertionError('Cancellation child did not initialize')
                        time.sleep(.05)
                    cancel(process, cancel_file)
                assert process.wait(timeout=30) != 0, 'Forced failure unexpectedly passed'
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        target = directory / mode
        assert 'intentional artifact smoke failure' in (target / 'console.log').read_text(encoding='utf-8')
        assert (target / 'screenshot.png').read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
        with zipfile.ZipFile(target / 'trace.zip') as trace:
            assert any(name.endswith('.trace') for name in trace.namelist())
            assert trace.testzip() is None
        assert json.loads((target / 'session.json').read_text(encoding='utf-8'))['passed'] is False
        reports.append({'mode': mode, 'passed': True, 'realChromium': True})
    (results_dir() / 'artifact-smoke.json').write_text(json.dumps(reports, indent=2) + '\n', encoding='utf-8')
    print('Real Chromium failure and cancellation artifacts verified')


if __name__ == '__main__':
    if len(sys.argv) == 2:
        child(sys.argv[1])
    else:
        verify()
