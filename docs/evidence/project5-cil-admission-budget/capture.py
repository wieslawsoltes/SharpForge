from pathlib import Path
import gzip
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time

ROOT = Path('/workspace/scratch/1692a10afba9')
WORKTREE = ROOT / 'p5-cil-admission-budget'
EXPECTED_HEAD = 'bfe3cb1f1d8c2d70b4b59bb291587159502d9c00'
GROUPS = {
    'focused': [
        'tests/a05-cil-admission-budget.test.js',
        'tests/a03-07-eh-admission.test.js',
        'tests/a05-callback-verification.test.js',
        'tests/a05-synchronous-callbacks.test.js',
    ],
    'replay': [
        'tests/compiler-canonical-managed-replay.test.js',
        'tests/compiler-direct-cil-adjacent-replay.test.js',
    ],
}
IMPORT = re.compile(r'''(?:^|[;\n])\s*(?:import\s+(?:[^;'"()]*?\s+from\s*)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s*)(["'])([^"']+)\1''')
DYNAMIC_IMPORT = re.compile(r'''\bimport\s*\(\s*(["'])([^"']+)\1''')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=WORKTREE)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(entries):
    rows = {}
    for record in git('ls-files', '-s', '-z').split(b'\0'):
        if not record:
            continue
        metadata, raw_path = record.split(b'\t', 1)
        _, expected, stage = metadata.decode().split()
        if stage != '0':
            raise RuntimeError('Unmerged tracked input: ' + raw_path.decode())
        name = raw_path.decode()
        file = WORKTREE / name
        if not file.is_file():
            continue
        data = file.read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if actual != expected:
            raise RuntimeError('Tracked input differs from the index: ' + name)
        rows[name] = {'bytes': len(data), 'gitBlob': actual, 'sha256': digest(data)}
    edges = {}
    pending = list(entries) + ['scripts/limited.js']
    pending.extend(str(path.relative_to(WORKTREE)) for path in
                   (WORKTREE / 'packages/compiler/test/differential/fixtures').rglob('*.js'))
    while pending:
        name = pending.pop()
        if name in edges:
            continue
        if name not in rows:
            raise RuntimeError('Import graph requires unavailable tracked input: ' + name)
        dependencies = []
        source = (WORKTREE / name).read_text()
        for _, specifier in IMPORT.findall(source) + DYNAMIC_IMPORT.findall(source):
            if specifier.startswith('node:'):
                continue
            if specifier.startswith('@sharpforge/'):
                package_name, _, subpath = specifier[len('@sharpforge/'):].partition('/')
                package = WORKTREE / 'packages' / package_name
                package_json = json.loads((package / 'package.json').read_text())
                exports = package_json.get('exports')
                entry = exports if isinstance(exports, str) else (exports or {}).get('./' + subpath if subpath else '.')
                target = package / (entry or package_json['main'])
            elif specifier.startswith('.'):
                target = (WORKTREE / name).parent / specifier
            else:
                raise RuntimeError('Unresolved bare import: ' + name + ' -> ' + specifier)
            dependency = str(target.resolve().relative_to(WORKTREE))
            dependencies.append(dependency)
            pending.append(dependency)
        edges[name] = sorted(set(dependencies))
    return {
        'head': git('rev-parse', 'HEAD').decode().strip(),
        'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
        'status': git('status', '--short').decode(),
        'trackedMaterializedInputs': rows,
        'staticImportGraph': edges,
        'graphNote': 'Literal imports plus all materialized differential fixture modules; dynamic fixture data are also hashed.',
    }


def persist(path, value):
    with path.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')


environment = os.environ.copy()
pinned = {
    'DOTNET_ROOT': str(ROOT / 'toolchain/dotnet'),
    'DOTNET': str(ROOT / 'toolchain/dotnet/dotnet'),
    'SHARPFORGE_ORACLE_DOTNET': str(ROOT / 'toolchain/dotnet/dotnet'),
}
environment.update(pinned)
for group in sys.argv[1:] or GROUPS:
    tests = GROUPS[group]
    stem = ROOT / ('cil-admission-budget-' + group)
    before = snapshot(tests)
    if before['head'] != EXPECTED_HEAD or before['status']:
        raise RuntimeError('Qualification requires the frozen clean source checkpoint')
    before_bytes = json.dumps(before, sort_keys=True).encode()
    Path(str(stem) + '-before.json.gz').write_bytes(gzip.compress(before_bytes, mtime=0))
    command = ['node', 'scripts/limited.js', 'node', '--test', '--test-concurrency=1', *tests]
    print(json.dumps({'group': group, 'phase': 'start', 'head': before['head'],
                      'inputCount': len(before['trackedMaterializedInputs']),
                      'graphModules': len(before['staticImportGraph'])}), flush=True)
    started = time.monotonic()
    with Path(str(stem) + '.log').open('xb') as log:
        completed = subprocess.run(command, cwd=WORKTREE, env=environment, stdout=log, stderr=subprocess.STDOUT)
    wall = time.monotonic() - started
    after = snapshot(tests)
    after_bytes = json.dumps(after, sort_keys=True).encode()
    Path(str(stem) + '-after.json.gz').write_bytes(gzip.compress(after_bytes, mtime=0))
    log = Path(str(stem) + '.log').read_bytes()
    report = {'head': before['head'], 'headAfter': after['head'], 'tree': before['tree'],
              'command': command, 'environment': pinned, 'exitCode': completed.returncode,
              'wallSeconds': wall, 'platform': platform.platform(),
              'node': subprocess.check_output(['node', '--version'], text=True).strip(),
              'sourceInputCount': len(before['trackedMaterializedInputs']),
              'staticGraphModuleCount': len(before['staticImportGraph']),
              'sourceAndGraphUnchanged': before_bytes == after_bytes,
              'beforeSnapshotSha256': digest(before_bytes), 'afterSnapshotSha256': digest(after_bytes),
              'statusAfter': after['status'], 'logBytes': len(log), 'logSha256': digest(log)}
    persist(Path(str(stem) + '.json'), report)
    print(json.dumps({'group': group, **report}), flush=True)
    if before_bytes != after_bytes:
        raise RuntimeError('Source or graph changed during qualification')
