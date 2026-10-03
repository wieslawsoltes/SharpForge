"""Define safety commands only for real, locked Rust crates and harnesses."""
import platform
import re
import sys
import tomllib

from qualify import MIRI_TOOLCHAIN, plan as workspace_plan
from source_inventory import inventory

CRATES = ('gc', 'runtime')
LANES = ('inventory', 'address', 'thread', 'miri', 'loom')
TARGET = 'x86_64-unknown-linux-gnu'


def step(argv, env=None, tests=False):
    return {'argv': argv, 'env': env or {}, 'requiresTests': tests}


def loom_ready(root, crate, manifest):
    path = root / 'rust' / crate / 'tests' / 'loom.rs'
    if not path.is_file() or path.is_symlink():
        return 'Dedicated tests/loom.rs model harness is absent'
    dependencies = [manifest.get('dependencies', {}), manifest.get('dev-dependencies', {})]
    for target in manifest.get('target', {}).values():
        dependencies.extend([target.get('dependencies', {}), target.get('dev-dependencies', {})])
    if not any('loom' in dependencies for dependencies in dependencies):
        return 'Crate does not declare a loom dependency'
    with (root / 'rust' / 'Cargo.lock').open('rb') as stream:
        packages = tomllib.load(stream).get('package', [])
    locked = [package for package in packages if package.get('name') == 'loom']
    if not locked or any(not re.fullmatch(r'[0-9a-f]{64}', package.get('checksum', '')) for package in locked):
        return 'Loom must be a reviewed registry dependency pinned by Cargo.lock with a checksum'
    return None


def commands(root, crate, lane, workspace):
    manifest = f'rust/{crate}/Cargo.toml'
    selected = workspace['channel'] if lane == 'loom' else MIRI_TOOLCHAIN
    components = 'miri,rust-src' if lane == 'miri' else 'rust-src'
    install = ['rustup', 'toolchain', 'install', selected, '--profile', 'minimal',
               '--component', components, '--target', TARGET]
    cargo = ['cargo', '+' + selected]
    common = ['--locked', '--manifest-path', manifest, '--target', TARGET]
    environment = {'CARGO_TARGET_DIR': str(root / 'artifacts' / 'rust-safety-target' / crate / lane),
                   'CARGO_BUILD_JOBS': '1', 'RUST_TEST_THREADS': '1',
                   'RUSTFLAGS': '', 'RUSTDOCFLAGS': '', 'RUST_BACKTRACE': '1'}
    if lane == 'miri':
        return [step(install), step(cargo + ['miri', 'setup', '--target', TARGET], environment),
                step(cargo + ['miri', 'test'] + common + ['--lib', '--tests', '--', '--test-threads=1'], environment, True)]
    if lane == 'loom':
        environment.update(RUSTFLAGS='--cfg loom', RUSTDOCFLAGS='--cfg loom')
        test = cargo + ['test'] + common + ['--release', '--test', 'loom', '--', '--test-threads=1']
    else:
        flags = f'-Zsanitizer={lane} -Cforce-frame-pointers=yes'
        environment.update(RUSTFLAGS=flags, RUSTDOCFLAGS=flags)
        test = cargo + ['test', '-Zbuild-std'] + common + ['--lib', '--tests', '--', '--test-threads=1']
    return [step(install), step(test, environment, True)]


def plan(root, crate, lane, host=None):
    """Inventory always runs; missing crates/unsupported hosts never qualify."""
    if crate not in CRATES or lane not in LANES:
        raise ValueError('Unknown Rust safety crate or lane')
    report = {'schemaVersion': 1, 'crate': 'rust/' + crate, 'lane': lane, 'target': TARGET,
              'status': 'planned', 'qualified': False, 'commands': [], 'results': []}
    report['inventory'] = inventory(root, crate)
    if report['inventory']['status'] != 'passed' or lane == 'inventory':
        report.update(status=report['inventory']['status'], reason=report['inventory']['reason'])
        return report
    manifest_path = root / 'rust' / crate / 'Cargo.toml'
    with manifest_path.open('rb') as stream:
        manifest = tomllib.load(stream)
    if not isinstance(manifest.get('package', {}).get('name'), str):
        raise ValueError('Safety target requires a real package manifest')
    workspace = workspace_plan(root)
    report.update(toolchain=workspace['channel'] if lane == 'loom' else MIRI_TOOLCHAIN,
                  toolchainFile=workspace['toolchainFile'])
    host = host or (sys.platform, platform.machine())
    if host not in (('linux', 'x86_64'), ('linux', 'AMD64')):
        report.update(status='unsupported', reason='Safety execution is configured only for Linux x86_64')
        return report
    if lane == 'loom':
        reason = loom_ready(root, crate, manifest)
        if reason:
            report.update(status='unsupported', reason=reason)
            return report
    report['commands'] = commands(root, crate, lane, workspace)
    return report
