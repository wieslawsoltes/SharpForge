from pathlib import Path
import gzip
import hashlib
import json
import os
import subprocess
import time

ROOT = Path('/workspace/scratch/1692a10afba9')
WORKTREE = ROOT / 'p5-cil-admission-budget'
PROPOSAL = ROOT / 'cil-admission-budget-performance-proposal'
EXPECTED = '6f8da343a3df1105e7789e5a7201dd3ae4983855'
SNAPSHOT = ROOT / 'cil-admission-budget-optimized-focused-after.json.gz'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def guard(snapshot, snapshot_bytes, packet):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=WORKTREE, text=True).strip()
    status = subprocess.check_output(['git', 'status', '--short'], cwd=WORKTREE, text=True)
    if head != EXPECTED or status:
        raise RuntimeError('Publication source is no longer frozen and clean')
    for path, entry in snapshot['trackedMaterializedInputs'].items():
        if digest((WORKTREE / path).read_bytes()) != entry['sha256']:
            raise RuntimeError('Tracked source changed: ' + path)
    for entry in packet['files']:
        if digest((PROPOSAL / entry['path']).read_bytes()) != entry['sha256']:
            raise RuntimeError('Reviewed benchmark packet changed: ' + entry['path'])
    return {'head': head, 'status': status, 'sourceInputs': len(snapshot['trackedMaterializedInputs']),
            'staticGraphModules': len(snapshot['staticImportGraph']), 'sourceSnapshotSha256': digest(snapshot_bytes),
            'benchmarkFiles': packet['files']}


snapshot_bytes = gzip.decompress(SNAPSHOT.read_bytes())
snapshot = json.loads(snapshot_bytes)
packet = json.loads((PROPOSAL / 'source-manifest.json').read_text())
before = guard(snapshot, snapshot_bytes, packet)
pinned = {'DOTNET_ROOT': str(ROOT / 'toolchain/dotnet'), 'DOTNET': str(ROOT / 'toolchain/dotnet/dotnet'),
          'SHARPFORGE_ORACLE_DOTNET': str(ROOT / 'toolchain/dotnet/dotnet')}
environment = dict(os.environ, **pinned)
command = ['node', 'scripts/limited.js', 'python3', str(PROPOSAL / 'paired.py'), '--repository', str(WORKTREE),
           '--baseline', '41ebd76987aa912659310d4015607f46110358ab', '--candidate', EXPECTED,
           '--output', str(ROOT / 'cil-admission-budget-optimized-performance.json')]
print(json.dumps({'phase': 'starting the single optimized performance comparison', 'head': EXPECTED}), flush=True)
started = time.monotonic()
log_path = ROOT / 'cil-admission-budget-optimized-performance-launcher.log'
with log_path.open('xb') as log:
    completed = subprocess.run(command, cwd=WORKTREE, env=environment, stdout=log, stderr=subprocess.STDOUT)
wall = time.monotonic() - started
after = guard(snapshot, snapshot_bytes, packet)
report = {'command': command, 'environment': pinned, 'exitCode': completed.returncode, 'wallSeconds': wall,
          'before': before, 'after': after, 'sourceAndGraphUnchanged': before == after,
          'logSha256': digest(log_path.read_bytes())}
with (ROOT / 'cil-admission-budget-optimized-performance-launcher.json').open('x') as output:
    json.dump(report, output, indent=2)
    output.write('\n')
print(json.dumps({'exitCode': completed.returncode, 'wallSeconds': wall,
                  'sourceAndGraphUnchanged': before == after, 'logSha256': report['logSha256']}), flush=True)
