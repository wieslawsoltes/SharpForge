from pathlib import Path
import hashlib
import json
import math
import statistics
import subprocess
import time

ROOT = Path('/workspace/scratch/f5d98b1de49e')
BASELINE = ROOT / 'SharpForge-p9-io-control-baseline'
CANDIDATE = ROOT / 'SharpForge-p9-writer-scalars'
OUT = CANDIDATE / 'artifacts/project9-resume/io-integrated-controls-abba'
OUT.mkdir(parents=True, exist_ok=True)
RUNNER = 'packages/bcl-io/benchmarks/string-writer-scalars.mjs'
RUNNER_HASH = 'a2cbf021f0c215a7963aa8ecbe24997bb6445220e8e4a40f0807a0e8a9cbd327'
REVISIONS = {'A': '726fbd8303042c7634a057807b51adeaddffa9a8',
             'B': '211db93e66b6b539540291c208ff6fdb971cc93f'}
TYPES = ['bool', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal']
CONTROLS = ['string-control', 'string-line-control', 'character-control', 'character-line-control',
            'separate-character-control', 'whole-buffer-write-control', 'slice-buffer-write-control',
            'whole-buffer-line-control', 'slice-buffer-line-control', 'separate-whole-buffer-control',
            'separate-slice-buffer-control']
CONTROLS += [f'scalar-{kind}-{operation}-string-control' for kind in TYPES for operation in ['Write', 'WriteLine']]
NEW_CASES = [f'scalar-{kind}-{operation}' for kind in TYPES for operation in ['Write', 'WriteLine', 'separate-line']]
assert len(CONTROLS) == 27 and len(NEW_CASES) == 24

preflight_source = r"""
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
const source = 'class Program { static void Main() {} }';
const fixture = readFileSync('tests/fixtures/text-writer/engines.js', 'utf8');
assert(fixture.includes("compileToIL('" + source + "')"));
const program = compileToIL(source);
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const hash = value => createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({source, sourceSha256: hash(source), fixtureSha256: hash(fixture),
  imageSha256: hash(JSON.stringify(program.image)), assemblySha256: hash(program.assembly)}, null, 2));
"""
identities = {}
for label, worktree in [('A', BASELINE), ('B', CANDIDATE)]:
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=worktree, text=True).strip() == REVISIONS[label]
    assert hashlib.sha256((worktree / RUNNER).read_bytes()).hexdigest() == RUNNER_HASH
    result = subprocess.run(['node', '--input-type=module', '-'], input=preflight_source, cwd=worktree,
                            text=True, capture_output=True, check=True)
    (OUT / f'{label}-program-identity.json').write_text(result.stdout)
    identities[label] = json.loads(result.stdout)
assert identities['A'] == identities['B'], 'The prepared empty program differs between comparison checkouts'
print(json.dumps({'untimedProgramIdentity': identities['A']}), flush=True)

def selectors(cases):
    return [value for case in cases for value in ['--case', case]]

reports = {}
for label in ['A1', 'B1', 'B2', 'A2']:
    worktree = BASELINE if label.startswith('A') else CANDIDATE
    target = OUT / f'{label}.json'
    assert not target.exists(), f'Refusing to overwrite {target}'
    command = ['node', '--expose-gc', RUNNER, '256', '256']
    if label.startswith('B'):
        command.append(str(OUT / 'A1.json'))
    command += selectors(CONTROLS)
    started = time.monotonic()
    with target.open('w') as output, target.with_suffix('.log').open('w') as errors:
        subprocess.run(command, cwd=worktree, stdout=output, stderr=errors, check=True)
    report = json.loads(target.read_text())
    assert report['commit'] == REVISIONS[label[0]] and report['comparisonBase'] == REVISIONS['A']
    assert report['runnerSha256'] == RUNNER_HASH
    assert report['calls'] == 256 and report['length'] == 256 and report['warmups'] == 1 and report['samples'] == 5
    assert report['hostGc'] and report['selectedEngines'] == ['source', 'cil']
    assert report['selectedCases'] == CONTROLS and report['workloadOrder'] == 'released-controls-first'
    reports[label] = report
    print(json.dumps({'completed': label, 'seconds': round(time.monotonic() - started, 3)}), flush=True)

for key in ['schemaVersion', 'runnerSha256', 'node', 'platform', 'arch', 'cpu', 'calls', 'length',
            'warmups', 'samples', 'hostGc', 'selectedEngines', 'selectedCases', 'workloadOrder']:
    assert all(report[key] == reports['A1'][key] for report in reports.values()), key

def quantiles(values):
    ordered = sorted(values)
    return {'median': statistics.median(ordered), 'p95': ordered[math.ceil(len(ordered) * .95) - 1]}

comparisons = []
for engine in ['source', 'cil']:
    for case in CONTROLS:
        baseline = [sample for label in ['A1', 'A2'] for sample in reports[label]['engines'][engine][case]['samples']]
        candidate = [sample for label in ['B1', 'B2'] for sample in reports[label]['engines'][engine][case]['samples']]
        assert len(baseline) == len(candidate) == 10
        metrics = {}
        for name in baseline[0]:
            a = quantiles([sample[name] for sample in baseline])
            b = quantiles([sample[name] for sample in candidate])
            metrics[name] = {'baseline': a, 'candidate': b,
                'medianChangePercent': (b['median'] / a['median'] - 1) * 100 if a['median'] else None,
                'medianAbsoluteChange': b['median'] - a['median']}
        for name in ['platformCalls', 'outputUnits', 'kind']:
            assert len({report['engines'][engine][case][name] for report in reports.values()}) == 1
        comparisons.append({'engine': engine, 'case': case, 'metrics': metrics,
            'platformCalls': reports['A1']['engines'][engine][case]['platformCalls'],
            'outputUnits': reports['A1']['engines'][engine][case]['outputUnits'],
            'baselineSamples': baseline, 'candidateSamples': candidate})
summary = {'main': '00c2489e659cbeaa29e9c5dfa4a3137fae4bd4ad',
    'baseline': REVISIONS['A'], 'candidate': REVISIONS['B'], 'runnerSha256': RUNNER_HASH,
    'programIdentity': identities['A'],
    'configuration': {key: reports['A1'][key] for key in ['node', 'platform', 'arch', 'cpu', 'calls', 'length', 'warmups', 'samples',
        'hostGc', 'selectedEngines', 'selectedCases', 'workloadOrder']},
    'processOrder': ['A1', 'B1', 'B2', 'A2'], 'retainedSamplesPerRevisionPerCase': 10,
    'comparisons': comparisons,
    'limitations': 'One serial root job on a shared machine; pooled p95 is the maximum of ten samples. No host JavaScript allocation or managed-GC-count measurement. Every retained sample is included.'}
(OUT.parent / 'io-integrated-controls-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'comparisons': [{'engine': row['engine'], 'case': row['case'],
    'elapsedMs': row['metrics']['elapsedMs']} for row in comparisons]}), flush=True)

target = OUT.parent / 'io-integrated-new-scalar-costs.json'
assert not target.exists(), f'Refusing to overwrite {target}'
with target.open('w') as output, target.with_suffix('.log').open('w') as errors:
    subprocess.run(['node', '--expose-gc', RUNNER, '256', '256', *selectors(NEW_CASES)],
                   cwd=CANDIDATE, stdout=output, stderr=errors, check=True)
new = json.loads(target.read_text())
assert new['commit'] == REVISIONS['B'] and new['selectedCases'] == NEW_CASES
assert all(not row.get('skipped', False) for engine in new['engines'].values() for row in engine.values())
print(json.dumps({'newScalarCosts': str(target), 'summary': str(OUT.parent / 'io-integrated-controls-summary.json')}), flush=True)
