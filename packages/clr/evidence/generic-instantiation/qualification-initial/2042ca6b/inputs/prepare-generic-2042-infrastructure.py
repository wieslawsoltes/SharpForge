#!/usr/bin/env python3
"""Root-authorized light I/O only: no Node/product/native execution."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import traceback

ROOT = Path('/workspace/scratch/7e3d2a445c44')
PLAN_PATH = ROOT / 'generic-2042-validation-plan.json'
EXPECTED_PLAN = '876d7cfd763c9a7d9057775450563f3978a97f051d23798335ad37fa4c73895a'
plan_bytes = PLAN_PATH.read_bytes()
assert hashlib.sha256(plan_bytes).hexdigest() == EXPECTED_PLAN
plan = json.loads(plan_bytes)
supplement_path = ROOT / 'generic-2042-preparation-supplement.json'
supplement_bytes = supplement_path.read_bytes()
assert hashlib.sha256(supplement_bytes).hexdigest() == '4926ac229b36d478337f7068a4f25cbf5a7de1cc770756ff8428a2538df91f51'
candidate = Path(plan['candidate']['workspace'])
baseline = Path(plan['workspaceDependencies']['baseline']['path'])
output = Path(plan['qualificationDirectory'])
assert not os.path.lexists(output)
assert not os.path.lexists(baseline)
output.mkdir()

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sha(data):
    return hashlib.sha256(data).hexdigest()

record = {'format': 'sharpforge.generic-2042-infrastructure', 'schemaVersion': 1,
          'status': 'preparing', 'startedUtc': now(), 'planSha256': EXPECTED_PLAN,
          'driverSha256': sha(Path(__file__).read_bytes()),
          'authorization': 'Root explicitly authorized local aliases, fresh sparse baseline, external receipts and source-byte snapshots only.',
          'productExecution': False, 'heavyExecution': False,
          'diskBefore': shutil.disk_usage(ROOT)._asdict(), 'commands': [], 'aliases': []}

def save():
    target = output / 'infrastructure-status.json'
    temporary = output / 'infrastructure-status.tmp'
    temporary.write_text(json.dumps(record, indent=2) + '\n')
    temporary.replace(target)

def exact_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as handle:
        handle.write(data)

def run(argv, cwd=candidate, stdin=None):
    command = {'argv': argv, 'cwd': str(cwd), 'startedUtc': now(),
               'environmentOverrides': {'GIT_NO_LAZY_FETCH': '1'}}
    if stdin is not None:
        command['stdin'] = stdin
    record['commands'].append(command)
    save()
    result = subprocess.run(argv, cwd=cwd, input=None if stdin is None else stdin.encode(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={**os.environ, 'GIT_NO_LAZY_FETCH': '1'}, timeout=120)
    index = len(record['commands'])
    for stream in ['stdout', 'stderr']:
        data = getattr(result, stream)
        name = f'infrastructure-{index:02}-{stream}.txt'
        exact_file(output / name, data)
        command[stream] = {'file': name, 'bytes': len(data), 'sha256': sha(data)}
    command.update(finishedUtc=now(), exitCode=result.returncode)
    save()
    assert result.returncode == 0, f'Infrastructure command failed: {argv!r}'
    return result.stdout.decode()

def aliases(root):
    for parent in [root / 'node_modules', root / 'node_modules/@sharpforge']:
        assert not parent.is_symlink(), f'Parent aliases another tree: {parent}'
        parent.mkdir(exist_ok=True)
    for item in plan['workspaceDependencies']['aliases']:
        path = root / item['path']
        assert not os.path.lexists(path), f'Unexpected alias collision: {path}'
        path.symlink_to(item['relativeTarget'], target_is_directory=True)
        expected = root / 'packages' / item['name'].split('/')[1]
        assert path.resolve(strict=True) == expected.resolve(strict=True)
        manifest_bytes = (path / 'package.json').read_bytes()
        manifest = json.loads(manifest_bytes)
        assert manifest['name'] == item['name']
        entry = path / manifest['exports']['.']
        assert entry.resolve(strict=True) == expected / 'src/index.js'
        record['aliases'].append({'root': str(root), **item, 'resolved': str(path.resolve()),
                                  'entrypoint': str(entry.resolve()), 'manifestSha256': sha(manifest_bytes)})
        save()

try:
    save()
    exact_file(output / 'inputs/generic-2042-validation-plan.json', plan_bytes)
    exact_file(output / 'inputs/generic-2042-preparation-supplement.json', supplement_bytes)
    exact_file(output / 'inputs/prepare-generic-2042-infrastructure.py', Path(__file__).read_bytes())
    assert run(['git', 'rev-parse', 'HEAD']).strip() == plan['candidate']['head']
    assert run(['git', 'status', '--porcelain']).strip() == ''
    assert run(['git', 'rev-parse', 'HEAD^{tree}']).strip() == plan['candidate']['repositoryTree']
    paths = set()
    for pin in plan['candidate']['filePins']:
        data = (candidate / pin['path']).read_bytes()
        assert len(data) == pin['bytes'] and sha(data) == pin['sha256'], pin['path']
        paths.add(pin['path'])
    aggregates = []
    for pin in plan['candidate']['sourceDirectories']:
        names = run(['git', 'ls-files', '-z', '--', pin['directory']]).split('\0')[:-1]
        digest = hashlib.sha256()
        size = 0
        for name in names:
            data = (candidate / name).read_bytes()
            digest.update(name.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
            size += len(data)
            paths.add(name)
        assert len(names) == pin['files'] and size == pin['logicalBytes'] and digest.hexdigest() == pin['contentSha256']
        aggregates.append(pin)
    source_manifest = []
    for name in sorted(paths):
        data = (candidate / name).read_bytes()
        exact_file(output / 'inputs/candidate' / name, data)
        source_manifest.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
    record['candidateInputs'] = {'head': plan['candidate']['head'], 'tree': plan['candidate']['repositoryTree'],
                                 'files': source_manifest, 'sourceDirectories': aggregates}
    save()
    aliases(candidate)
    base = plan['workspaceDependencies']['baseline']
    run(base['createArgv'])
    run(base['sparseSetArgv'], stdin=base['sparseSetStdin'])
    materialized = (baseline / 'package.json').is_file() and (baseline / 'packages/clr/src/index.js').is_file()
    record['baselineMaterializedAfterSparseSet'] = materialized
    save()
    # Root-approved supplement: safe only in this newly created, untouched sparse tree.
    run(['git', 'read-tree', '-mu', 'HEAD'], cwd=baseline)
    assert run(['git', 'rev-parse', 'HEAD'], cwd=baseline).strip() == base['commit']
    assert run(['git', 'status', '--porcelain'], cwd=baseline).strip() == ''
    for pin in base['packageSourceTrees']:
        assert run(['git', 'rev-parse', 'HEAD:' + pin['directory']], cwd=baseline).strip() == pin['gitTree']
    selected = [line.lstrip('/') for line in base['sparseSetStdin'].splitlines()]
    baseline_files = []
    tree = run(['git', 'ls-tree', '-r', '-z', 'HEAD'], cwd=baseline)
    for entry in tree.split('\0'):
        if not entry:
            continue
        metadata, name = entry.split('\t', 1)
        if not any(name.startswith(prefix) if prefix.endswith('/') else name == prefix for prefix in selected):
            continue
        mode, kind, oid = metadata.split()
        assert kind == 'blob' and mode in ['100644', '100755'], name
        data = (baseline / name).read_bytes()
        actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        assert actual == oid, name
        baseline_files.append({'path': name, 'bytes': len(data), 'sha256': sha(data), 'gitBlob': oid})
    assert len(baseline_files) == base['trackedFiles']
    assert sum(item['bytes'] for item in baseline_files) == base['logicalTrackedBytes']
    record['baselineInputs'] = {'head': base['commit'], 'files': baseline_files,
                               'sourceTrees': base['packageSourceTrees']}
    save()
    aliases(baseline)
    for name in plan['steps'][1]['files']:
        assert not os.path.lexists(candidate / 'tests/fixtures/clr-generic-instantiation' / name), name
    record['candidateFinalStatus'] = run(['git', 'status', '--porcelain'])
    record['baselineFinalStatus'] = run(['git', 'status', '--porcelain'], cwd=baseline)
    assert record['candidateFinalStatus'] == record['baselineFinalStatus'] == ''
    record['status'] = 'prepared-no-execution'
except BaseException as error:
    record['status'] = 'failed'
    record['error'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
    raise
finally:
    record['finishedUtc'] = now()
    record['diskAfter'] = shutil.disk_usage(ROOT)._asdict()
    save()
    print(json.dumps({key: record.get(key) for key in ['status', 'startedUtc', 'finishedUtc', 'diskBefore', 'diskAfter', 'error']}, indent=2))
