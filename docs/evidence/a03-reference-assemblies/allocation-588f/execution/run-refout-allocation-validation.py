import datetime
import glob
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path('/workspace/scratch/7e3d2a445c44')
preparation = ROOT / 'refout-allocation-588f-validation-plan.json'
plan = json.loads(preparation.read_text())
repo = pathlib.Path(plan['cwd'])
steps = [
    {'label': 'tests', 'argv': plan['focusedArgv'], 'log': plan['focusedLog']},
    {'label': 'native', 'argv': plan['nativeArgv'], 'log': plan['nativeLog']},
    *[dict(step, label=label) for step, label in zip(plan['mainNativeFixtures'], ['attribute-targets', 'pseudo-attributes'])],
    *[dict(step, label=label) for step, label in zip(plan['postOptimizationMeasurement']['commands'], ['metadata', 'refout'])],
]
index = int(sys.argv[1])
step = steps[index]
prefix = 'refout-allocation-588f2b271-'
for previous in steps[:index]:
    prior = json.loads((ROOT / (prefix + previous['label'] + '-execution.json')).read_text())
    assert prior['exitCode'] == 0
status_path = ROOT / (prefix + step['label'] + '-execution.json')
log = pathlib.Path(step['log'])
assert not log.exists() and not status_path.exists()
actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
assert actual == plan['frozenHead']
changes = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo, text=True)
assert not changes.strip()
argv = []
for argument in step['argv']:
    if '*' in argument:
        expanded = sorted(glob.glob(argument, root_dir=repo))
        assert expanded
        argv.extend(expanded)
    else:
        argv.append(argument)
destination = None
for flag in ('--output', '--scratch'):
    if flag in argv:
        destination = repo / argv[argv.index(flag) + 1]
        assert not destination.exists()
environment = dict(os.environ)
if index < 4:
    environment.update(plan['environment'])
else:
    # Match the earlier benchmark environment; registry compilation does not need the native SDK.
    environment.pop('DOTNET_ROOT', None)
    environment.pop('DOTNET', None)
keys = ['PATH', 'CI', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_ENV', 'LANG', 'LC_ALL', 'TZ',
        'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_MAX_OLD_SPACE_MB',
        'DOTNET_ROOT', 'DOTNET']
hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
source_paths = [
    'packages/compiler/src/codegen/metadata/pseudo-attributes.js',
    'packages/compiler/src/codegen/metadata/attribute-targets.js',
    'tests/a03-22-attribute-dispatch.test.js',
    'packages/compiler/src/codegen/metadata/custom-attributes.js',
    'packages/compiler/src/codegen/metadata/member-plan.js',
    'packages/compiler/src/codegen/metadata/symbol-metadata.js',
    'packages/compiler/src/codegen/metadata/serialized-type-names.js',
    'packages/compiler/src/codegen/metadata/fixed-buffer-type-name.js',
    'packages/cil/tools/benchmark-reference-assemblies.mjs',
    'packages/cil/tools/capture-reference-assemblies.mjs',
    'packages/cil/tools/reference-consumers.mjs',
    'tests/fixtures/a03-reference-assemblies/surface.cs',
]
record = {
    'label': step['label'], 'head': actual, 'cwd': str(repo), 'argv': argv,
    'preparationSha256': hash_file(preparation), 'sourceSha256': {path: hash_file(repo / path) for path in source_paths},
    'environment': {key: environment.get(key) for key in keys},
    'environmentNote': 'Relevant execution variables; unrelated values/secrets omitted. SDK environment used for correctness only.',
    'nodeExecutable': str(pathlib.Path(shutil.which('node')).resolve()),
    'resourceWrapper': 'scripts/limited.js with its default 2048 MiB V8 cap and serial resource slot.',
    'log': str(log), 'output': str(destination) if destination else None,
    'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'running',
    'scheduling': 'Exclusive team heavy slot; sequential frozen commands, no retries.',
}
status_path.write_text(json.dumps(record, indent=2) + '\n')
with log.open('x') as stream:
    result = subprocess.run(argv, cwd=repo, env=environment, stdout=stream, stderr=subprocess.STDOUT)
outputs = []
if destination and destination.exists():
    outputs = sorted(path for path in destination.rglob('*') if path.is_file()) if destination.is_dir() else [destination]
record.update({
    'exitCode': result.returncode, 'status': 'passed' if result.returncode == 0 else 'failed',
    'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'logSha256': hash_file(log),
    'outputs': [{'path': str(path), 'bytes': path.stat().st_size, 'sha256': hash_file(path)} for path in outputs],
})
status_path.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'label': step['label'], 'exitCode': result.returncode, 'log': str(log), 'execution': str(status_path)}), flush=True)
sys.exit(result.returncode)
