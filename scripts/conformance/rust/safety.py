"""SF-A29-T35 safety lane entry point; unsupported never means qualified."""
import argparse
import json
from pathlib import Path
import platform
import subprocess
import sys

from safety_execute import execute
from safety_plan import CRATES, LANES, plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--crate', choices=CRATES, required=True)
    parser.add_argument('--lane', choices=LANES, required=True)
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = {'schemaVersion': 1, 'status': 'failed', 'qualified': False,
              'crate': 'rust/' + args.crate, 'lane': args.lane}
    try:
        if not 1 <= args.timeout <= 3600:
            raise ValueError('Timeout must be 1..3600 seconds')
        root = args.root.resolve()
        report = plan(root, args.crate, args.lane)
        if not args.plan:
            report = execute(root, report, args.timeout)
        report['commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        report['host'] = {'platform': sys.platform, 'machine': platform.machine()}
        report['limitations'] = [
            'Lexical source inventory does not expand macros, generated code or dependencies',
            'Passing tests do not prove soundness or exhaustive concurrency coverage',
            'Other host platforms and Wasm are unsupported by these safety lanes',
            'Cargo-fuzz is unimplemented: prior automatic approval review rejected the fuzzing action twice',
        ]
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        report.update(status='failed', qualified=False, error=str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report.get(key) for key in ('crate', 'lane', 'status', 'qualified', 'reason', 'error')}))
    return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    sys.exit(main())
