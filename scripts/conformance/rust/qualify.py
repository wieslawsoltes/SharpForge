"""Pinned Rust workspace CI plan. Absence is explicitly not qualification."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import tomllib

DENY_VERSION = '0.18.3'
MIRI_TOOLCHAIN = 'nightly-2025-08-01'


def plan(root):
    workspace = root / 'rust'
    if not workspace.exists():
        return {'schemaVersion': 1, 'status': 'not-applicable', 'qualified': False,
                'reason': 'rust/ workspace is absent', 'commands': []}
    if not (workspace / 'Cargo.toml').is_file() or not (workspace / 'Cargo.lock').is_file():
        raise ValueError('Existing rust/ requires Cargo.toml and committed Cargo.lock')
    toolchain_file = workspace / 'rust-toolchain.toml'
    if not toolchain_file.exists():
        toolchain_file = root / 'rust-toolchain.toml'
    with toolchain_file.open('rb') as stream:
        toolchain = tomllib.load(stream)['toolchain']
    channel = toolchain.get('channel', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+|nightly-\d{4}-\d{2}-\d{2}', channel) or 'path' in toolchain:
        raise ValueError('rust-toolchain.toml must pin an exact release or dated nightly')
    if (workspace / 'rust-toolchain').exists() or (root / 'rust-toolchain').exists():
        raise ValueError('Legacy rust-toolchain may override the reviewed TOML pin')
    if not (workspace / 'deny.toml').is_file():
        raise ValueError('rust/deny.toml is required for explicit cargo-deny policy')
    commands = [
        ['rustup', 'toolchain', 'install', channel, '--profile', 'minimal', '--component', 'rustfmt,clippy',
         '--target', 'wasm32-unknown-unknown'],
        ['cargo', '+' + channel, 'fmt', '--all', '--', '--check'],
        ['cargo', '+' + channel, 'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings'],
        ['cargo', '+' + channel, 'test', '--locked', '--workspace'],
        ['cargo', '+' + channel, 'build', '--locked', '--workspace', '--target', 'wasm32-unknown-unknown'],
        ['cargo', '+' + channel, 'install', 'cargo-deny', '--version', DENY_VERSION, '--locked'],
        ['cargo', '+' + channel, 'deny', '--locked', 'check'],
        ['rustup', 'toolchain', 'install', MIRI_TOOLCHAIN, '--profile', 'minimal', '--component', 'miri'],
        ['cargo', '+' + MIRI_TOOLCHAIN, 'miri', 'setup'],
        ['cargo', '+' + MIRI_TOOLCHAIN, 'miri', 'test', '--locked', '--workspace'],
    ]
    return {'schemaVersion': 1, 'status': 'planned', 'qualified': False, 'channel': channel,
            'toolchainFile': toolchain_file.relative_to(root).as_posix(), 'miri': MIRI_TOOLCHAIN,
            'cargoDeny': DENY_VERSION, 'commands': commands}


def execute(root, report, timeout):
    report['results'] = []
    if report['status'] == 'not-applicable':
        return report
    for command in report['commands']:
        started = time.monotonic()
        try:
            result = subprocess.run(command, cwd=root / 'rust', timeout=timeout, capture_output=True,
                                    text=True, check=False)
            row = {'argv': command, 'exitCode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
        except subprocess.TimeoutExpired:
            row = {'argv': command, 'exitCode': None, 'error': 'timeout'}
        except KeyboardInterrupt:
            row = {'argv': command, 'exitCode': None, 'error': 'cancelled'}
        row['seconds'] = time.monotonic() - started
        report['results'].append(row)
        if row['exitCode'] != 0:
            report['status'] = 'failed'
            return report
    report['status'] = 'passed'
    report['qualified'] = True
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--output', type=Path, default=Path('artifacts/rust-qualification.json'))
    args = parser.parse_args()
    report = {'schemaVersion': 1, 'status': 'failed', 'qualified': False}
    try:
        if not 1 <= args.timeout <= 3600:
            raise ValueError('Timeout must be 1..3600 seconds')
        report = plan(args.root.resolve())
        if not args.plan:
            report = execute(args.root.resolve(), report, args.timeout)
        report['commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.root, text=True).strip()
        report['platform'] = sys.platform
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        report.update(status='failed', qualified=False, error=str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    sys.exit(main())
