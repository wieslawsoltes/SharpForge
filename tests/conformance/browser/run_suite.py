"""Run one real browser suite with time to preserve diagnostics before CI timeout."""
from pathlib import Path
import argparse
import json
import os
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
SUITES = {
    'browser': 'browser_test.py', 'managed': 'browser_managed_test.py',
    'workspace': 'browser_workspace_test.py', 'msbuild': 'browser_msbuild_test.py',
    'native-explorer': 'browser_native_explorer_test.py', 'standalone': 'standalone_test.py',
    **{'release' + version: 'browser_release' + version + '_test.py'
       for version in ('05', '06', '08', '09', '10', '11', '12', '13', '14')},
}


def cancel(process):
    if os.name == 'nt':
        process.send_signal(signal.CTRL_BREAK_EVENT)
    else:
        process.send_signal(signal.SIGTERM)


def run(suite, timeout):
    directory = Path(os.getenv('SHARPFORGE_RESULTS_DIR', 'artifacts/results'))
    if not directory.is_absolute():
        directory = ROOT / directory
    directory.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    process = subprocess.Popen([sys.executable, str(ROOT / 'tests' / SUITES[suite])], cwd=ROOT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    timed_out = False
    try:
        code = process.wait(timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        timed_out = True
        cancel(process)
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        code = 124
    (directory / ('suite-' + suite + '.json')).write_text(json.dumps({
        'suite': suite, 'command': [sys.executable, 'tests/' + SUITES[suite]],
        'exitCode': code, 'timedOut': timed_out, 'seconds': time.monotonic() - start,
    }, indent=2) + '\n', encoding='utf8')
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suite', choices=SUITES)
    parser.add_argument('--timeout', type=int, default=1200)
    args = parser.parse_args()
    if args.timeout < 1:
        parser.error('--timeout must be positive')
    sys.exit(run(args.suite, args.timeout))
