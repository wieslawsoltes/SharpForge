import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path('/workspace/scratch/7e3d2a445c44')
preparation = ROOT / 'refout-benchmark-preparation.json'
plan = json.loads(preparation.read_text())
run = plan['commands'][int(sys.argv[1])]
status_path = ROOT / ('refout-' + run['label'] + '-execution.json')
output = pathlib.Path(run['output'])
log = pathlib.Path(run['stdoutAndStderr'])
assert not output.exists() and not log.exists() and not status_path.exists()
for name in ('candidate', 'baseline'):
    checkout = plan[name]
    actual = subprocess.check_output(['git', '-C', checkout['checkout'], 'rev-parse', 'HEAD'], text=True).strip()
    assert actual == checkout['revision']
    changes = subprocess.check_output(['git', '-C', checkout['checkout'], 'status', '--porcelain', '--untracked-files=no'], text=True)
    assert not changes.strip()
for name, expected in plan['inputHashes'].items():
    path = pathlib.Path(plan['candidate']['checkout']) / name
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
keys = ['PATH', 'CI', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'LANG', 'LC_ALL', 'TZ',
        'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_MAX_OLD_SPACE_MB',
        'DOTNET_ROOT', 'DOTNET']
record = dict(run)
record.update({
    'status': 'running',
    'preparationSha256': hashlib.sha256(preparation.read_bytes()).hexdigest(),
    'environment': {key: os.environ.get(key) for key in keys},
    'environmentNote': 'Relevant execution variables; unrelated environment values and secrets are intentionally excluded.',
    'nodeExecutable': str(pathlib.Path(shutil.which('node')).resolve()),
    'resourceWrapper': 'scripts/limited.js applies limitedEnv from scripts/planning/lib/resource-limits.js; inherited environment otherwise unchanged.',
    'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'scheduling': 'Sole team heavy slot granted by root; one run at a time, no retries.',
})
status_path.write_text(json.dumps(record, indent=2) + '\n')
with log.open('x') as stream:
    result = subprocess.run(run['argv'], cwd=run['cwd'], stdout=stream, stderr=subprocess.STDOUT)
record.update({
    'status': 'passed' if result.returncode == 0 else 'failed',
    'exitCode': result.returncode,
    'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(),
    'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None,
})
status_path.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'label': run['label'], 'exitCode': result.returncode, 'execution': str(status_path), 'log': str(log)}), flush=True)
sys.exit(result.returncode)
