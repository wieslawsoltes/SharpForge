import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time

root = pathlib.Path('/workspace/scratch/42f7738360b9/a05-source-memory')
evidence = pathlib.Path('/workspace/scratch/42f7738360b9/a05-native-numeric-replay-139917fe5f-20261004')
revision = '139917fe5f1a623c75642abbc1e9bbab0dc536df'
evidence.mkdir(exist_ok=False)
env = dict(os.environ, SHARPFORGE_TEST_CONCURRENCY='1', SHARPFORGE_MAX_PARALLEL_RUNS='1', SHARPFORGE_MAX_OLD_SPACE_MB='512')
node = shutil.which('node')

def output(argv):
    return subprocess.check_output(argv, cwd=root, env=env, text=True).strip()

def write(name, data):
    with (evidence / name).open('x') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')

def identity():
    return {'commit': output(['git', 'rev-parse', 'HEAD']), 'tree': output(['git', 'rev-parse', 'HEAD^{tree}']),
            'status': output(['git', 'status', '--porcelain=v1', '--untracked-files=all']),
            'trackedDirty': bool(output(['git', 'status', '--porcelain=v1', '--untracked-files=no']))}

before = identity()
if before['commit'] != revision or before['trackedDirty']:
    raise RuntimeError('Expected the exact clean tracked qualification revision')

# Preserve the externally recreated obsolete module without editing any tracked file.
obsolete = root / 'packages/runtime/src/execution/source-frame-scrub.js'
if obsolete.exists():
    shutil.copyfile(obsolete, evidence / 'source-frame-scrub.untracked-preserved.js')
    obsolete.unlink()

oracle = root / 'tests/fixtures/a05/numeric-oracle'
provenance = json.loads((oracle / 'provenance.json').read_text())
checks = []
for name, entry in provenance['files'].items():
    data = (oracle / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != entry['bytes'] or digest != entry['sha256']:
        raise RuntimeError('Native oracle fixture mismatch: ' + name)
    checks.append({'path': str((oracle / name).relative_to(root)), 'bytes': len(data), 'sha256': digest})

runtime = json.loads(output([node, '--input-type=module', '-e',
    "import v8 from 'node:v8';import os from 'node:os';console.log(JSON.stringify({execPath:process.execPath,node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execArgv:process.execArgv,heapLimit:v8.getHeapStatistics().heap_size_limit,cpus:os.cpus().map(x=>x.model),release:os.release()}))"]))
resources = {key: env.get(key) for key in ['SHARPFORGE_TEST_CONCURRENCY','SHARPFORGE_MAX_PARALLEL_RUNS','SHARPFORGE_MAX_OLD_SPACE_MB','NODE_OPTIONS']}
prefix = [node, 'scripts/limited.js', node, '--expose-gc', '--test', '--test-concurrency=1']
commands = [('numeric-differential', prefix + ['tests/numeric-differential.test.js'])]
write('preflight.json', {'format':'SharpForge.IndependentReplay/1', 'startedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'identity':identity(), 'initialIdentity':before, 'runtime':runtime, 'resourceEnvironment':resources,
    'commands':commands, 'nativeOracleProvenance':provenance, 'oracleFixtureChecks':checks,
    'scope':'Existing stored .NET10 numeric oracle replay on Node; not fresh CLR or other-platform execution.'})
print('Preflight verified all', len(checks), 'oracle files; starting serial corpora at', revision, flush=True)
results = []
for name, argv in commands:
    start_identity = identity()
    if start_identity['commit'] != revision or start_identity['trackedDirty']:
        raise RuntimeError('Product changed before ' + name)
    child_env = dict(env)
    if name == 'byref-gc-stress':
        child_env['SHARPFORGE_BYREF_STRESS_REPORT'] = str(evidence / 'byref-gc-stress.json')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    timer = time.monotonic()
    print('START', name, started, flush=True)
    with (evidence / (name + '.log')).open('x') as log:
        result = subprocess.run(argv, cwd=root, env=child_env, stdout=log, stderr=subprocess.STDOUT)
    row = {'name':name, 'command':argv, 'resourceEnvironment':resources, 'startedUTC':started,
        'completedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(), 'elapsedSeconds':time.monotonic()-timer,
        'exitCode':result.returncode, 'startIdentity':start_identity, 'endIdentity':identity()}
    if name == 'byref-gc-stress':
        row['reportEnvironment'] = {'SHARPFORGE_BYREF_STRESS_REPORT':child_env['SHARPFORGE_BYREF_STRESS_REPORT']}
    write(name + '-execution.json', row)
    results.append(row)
    print('END', name, 'exit', result.returncode, 'seconds', round(row['elapsedSeconds'], 3), flush=True)
write('completion.json', {'format':'SharpForge.IndependentReplay/1', 'revision':revision, 'results':results,
    'endIdentity':identity(), 'allCommandsSucceeded':all(item['exitCode']==0 for item in results)})
print('COMPLETE', evidence, flush=True)
