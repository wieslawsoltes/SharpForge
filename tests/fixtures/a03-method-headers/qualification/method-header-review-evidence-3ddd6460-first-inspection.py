"""Independent review of existing records only; never launches SharpForge or a qualification command."""
from pathlib import Path
import datetime
import hashlib
import json
import math
import os
import statistics
import subprocess
import zipfile

ROOT = Path('/workspace/scratch/7e3d2a445c44')
PLAN_PATH = ROOT / 'method-header-preflight-3ddd6460.json'
PLAN = json.loads(PLAN_PATH.read_bytes())
EXECUTION = Path(PLAN['executionDirectory'])
ORDER = ['baseline-controls', 'candidate-controls', 'baseline-corpus', 'candidate-corpus']
ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_NO_LAZY_FETCH': '1'}


def identity(path):
    path = Path(path)
    assert path.is_file() and not path.is_symlink()
    hashed = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hashed.update(chunk)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': hashed.hexdigest()}


def git(path, *args):
    return subprocess.check_output(['/usr/local/bin/git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
                                   '-C', str(path), *args], env=ENV, text=True).strip()


def distribution(values):
    ordered = sorted(values)
    count = len(values)
    return {'samples': count, 'min': ordered[0], 'median': statistics.median(ordered), 'mean': statistics.mean(ordered),
            'p95': ordered[math.ceil(count * .95) - 1], 'p99': ordered[math.ceil(count * .99) - 1], 'max': ordered[-1],
            'populationStandardDeviation': statistics.pstdev(ordered)}


def change(before, after):
    return {'baseline': before, 'candidate': after, 'absoluteChange': after - before,
            'changePercent': (after / before - 1) * 100 if before else None}


def save_exclusive(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


assert identity(PLAN_PATH)['sha256'] == 'c29a45dcbc86dfae886d404ae6a62d863b5dae8d64fa1af7c8c7a27eacab04b5'
assert identity(ROOT / 'method-header-run-step-3ddd6460.py')['sha256'] == '9ba748c491c798f5ec320e5e27d8665c8c6387a589ddd918188cf35c76ed6655'
assert identity(ROOT / 'method-header-benchmark-preflight-failed-3ddd6460.json')['sha256'] == '6a6234701b38b92c422b3c1fead495570753e833a804bf725589f58b9ee56427'
expected_snapshot = {'checkouts': {}, 'tools': PLAN['toolFiles']}
for side, expected in PLAN['checkouts'].items():
    path = Path(expected['path'])
    assert git(path, 'rev-parse', 'HEAD') == expected['head']
    assert git(path, 'rev-parse', 'HEAD^{tree}') == expected['tree']
    assert git(path, 'status', '--porcelain', '--untracked-files=all') == ''
    assert sorted(p.name for p in (path / 'node_modules/@sharpforge').iterdir()) == sorted(row['name'] for row in expected['aliases'])
    for alias in expected['aliases']:
        link = path / 'node_modules/@sharpforge' / alias['name']
        assert link.is_symlink() and os.readlink(link) == alias['target'] and str(link.resolve()) == alias['resolved']
    for row in expected['files']:
        actual = identity(path / row['path'])
        assert actual['bytes'] == row['bytes'] and actual['sha256'] == row['sha256']
    expected_snapshot['checkouts'][side] = {'head': expected['head'], 'tree': expected['tree'], 'trackedChanges': '',
        'untrackedNonignored': '', 'aliases': expected['aliases'], 'files': expected['files']}
for row in PLAN['toolFiles'] + PLAN['immutablePreparationFiles']:
    assert identity(row['path']) == row
assert identity(PLAN['sourceArchive']['path']) == PLAN['sourceArchive']
with zipfile.ZipFile(PLAN['sourceArchive']['path']) as archive:
    assert len(archive.namelist()) == 2461
    for side, expected in PLAN['checkouts'].items():
        for row in expected['files']:
            data = archive.read(side + '/' + row['path'])
            assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256']
    for row in PLAN['preservedSourcePreparationFailure']['correctedArchivePreservesAllHistoricalEntries']:
        data = archive.read(row['path'])
        assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256']

history_pins = {}


def verify_historical_pins(value):
    if isinstance(value, dict):
        if {'path', 'bytes', 'sha256'} <= set(value) and str(value['path']).startswith(str(ROOT) + '/'):
            expected = {key: value[key] for key in ['path', 'bytes', 'sha256']}
            assert identity(expected['path']) == expected
            history_pins[expected['path']] = expected
        for child in value.values():
            verify_historical_pins(child)
    elif isinstance(value, list):
        for child in value:
            verify_historical_pins(child)


for key in PLAN:
    if key.startswith('preserved') or key in ['adjudicatedPrerequisites', 'previousPlan']:
        verify_historical_pins(PLAN[key])
adjudication = json.loads((ROOT / 'method-header-adapter-adjudication-c0e3352e.json').read_bytes())
verify_historical_pins(adjudication)
assert adjudication['disposition'] == 'test-passed-recorder-failed' and adjudication['testWasRerun'] is False
for key in ['preservedFirstNativeFailure', 'preservedNativeAssemblerFailure', 'preservedNativeHeaderPolicyFailure']:
    assert json.loads(Path(PLAN[key]['execution']['path']).read_bytes())['status'] == 'failed'

receipts = {}
snapshot_records = []
for name in ['native', 'refout', 'focused', *ORDER]:
    directory = EXECUTION / 'steps' / name
    path = directory / 'execution.json'
    record = json.loads(path.read_bytes())
    assert record['status'] == 'passed' and record['exitCode'] == 0 and record['signal'] is None
    assert record['sourcesAndToolsUnchanged'] is True and record['argv'] == PLAN['steps'][name]['argv']
    for snapshot_name in ['source-before.json', 'source-after.json']:
        snapshot_path = directory / snapshot_name
        assert json.loads(snapshot_path.read_bytes()) == expected_snapshot
        snapshot_records.append(identity(snapshot_path))
    for row in record['outerLogs'] + record['outputInventory']:
        assert identity(row['path']) == row
    receipts[name] = {'execution': identity(path), 'startedAt': record['startedAt'], 'finishedAt': record['finishedAt'],
        'elapsedSeconds': record['elapsedSeconds'], 'exitCode': 0, 'signal': None, 'argv': record['argv'],
        'environment': record['environment'], 'rawLogs': record['outerLogs'], 'outputs': record['outputInventory']}
assert len({row['sha256'] for row in snapshot_records}) == 1
assert not (EXECUTION / 'execution.lock').exists()

reports = {}
cohorts = {}
machine = None
for name in ORDER:
    step = PLAN['steps'][name]
    path = Path(step['output'])
    report = json.loads(path.read_bytes())
    assert json.loads((EXECUTION / 'steps' / name / 'stdout.log').read_bytes()) == report
    assert report['qualified'] is True and 'failure' not in report and report['gcExposed'] is True
    assert report['nodeArguments'] == ['--expose-gc']
    assert report['arguments'] == [PLAN['nodeExecutable'], report['driverPath'], *step['argv'][5:]]
    for key, value in step['benchmark'].items():
        assert report[key] == value, (name, key)
    for path_key, hash_key in [('driverPath', 'driverSHA256'), ('sourcePath', 'sourceSHA256'), ('compilerEntry', 'compilerEntrySHA256')]:
        assert identity(report[path_key])['sha256'] == report[hash_key]
    assert report['sourceBytes'] == Path(report['sourcePath']).stat().st_size
    this_machine = {key: report[key] for key in ['node', 'platform', 'architecture', 'osRelease', 'cpu', 'logicalCpus', 'totalMemoryBytes']}
    if machine is None:
        machine = this_machine
    assert machine == this_machine
    assert len(report['samplesMs']) == len(report['heapUsedDeltas']) == 121
    assert all(math.isfinite(value) and value >= 0 for value in report['samplesMs'])
    assert all(math.isfinite(value) for value in report['heapUsedDeltas'])
    assert [report[key] for key in ['firstCompilations', 'warmupCompilations', 'measuredCompilations']] == [1, 20, 100]
    measured = distribution(report['samplesMs'][21:])
    assert report['firstCompileMs'] == report['samplesMs'][0]
    for key in ['median', 'p95', 'p99']:
        assert report[key + 'Ms'] == measured[key]
    checkout = Path(report['compilerEntry']).parents[3]
    for alias in report['aliases']:
        expected = checkout / 'packages' / alias['name'].split('/')[-1] / 'src/index.js'
        assert alias['ownCheckout'] is True and alias['path'] == str(expected)
    cohorts[name] = {'report': identity(path), 'execution': receipts[name]['execution'],
        'compilerImportMs': report['compilerImportMs'], 'firstCompileMs': report['firstCompileMs'],
        'measuredCompileMs': measured, 'warmupCompileMs': distribution(report['samplesMs'][1:21]),
        'measuredHeapUsedDeltaBytes': distribution(report['heapUsedDeltas'][21:]),
        'firstHeapUsedDeltaBytes': report['heapUsedDeltas'][0], 'warmupHeapUsedDeltaBytes': distribution(report['heapUsedDeltas'][1:21]),
        'chronologicalQuarterCompileMedians': [statistics.median(report['samplesMs'][21 + index * 25:46 + index * 25]) for index in range(4)],
        'chronologicalQuarterHeapMedians': [statistics.median(report['heapUsedDeltas'][21 + index * 25:46 + index * 25]) for index in range(4)],
        'assemblyBytes': report['assemblyBytes'], 'assemblySHA256': report['assemblySHA256']}
    reports[name] = report

comparisons = {}
for workload in ['controls', 'corpus']:
    baseline = reports['baseline-' + workload]
    candidate = reports['candidate-' + workload]
    before = cohorts['baseline-' + workload]
    after = cohorts['candidate-' + workload]
    comparison = {key: change(before[key], after[key]) for key in ['compilerImportMs', 'firstCompileMs', 'assemblyBytes']}
    for category in ['measuredCompileMs', 'measuredHeapUsedDeltaBytes', 'warmupCompileMs', 'warmupHeapUsedDeltaBytes']:
        comparison[category] = {key: change(before[category][key], after[category][key])
                               for key in before[category] if key != 'samples'}
    assert len(baseline['methods']) == len(candidate['methods']) == (3 if workload == 'controls' else 13)
    methods = []
    for old, new in zip(baseline['methods'], candidate['methods']):
        for key in ['name', 'token', 'codeSize', 'codeSHA256', 'localSignature', 'handlers', 'moreSections']:
            assert old[key] == new[key], (workload, old['name'], key)
        assert old['headerSize'] == 12
        if new['headerSize'] == 1:
            assert new['maxStack'] == 8 and new['codeSize'] < 64 and new['localSignature'] == 0
            assert not new['handlers'] and not new['moreSections'] and not new['initLocals']
        else:
            assert new['headerSize'] == 12 and new['initLocals']
        methods.append({'name': old['name'], 'token': old['token'], 'ILSha256': old['codeSHA256'],
            'ILUnchanged': True, 'handlersUnchanged': True, 'baselineHeaderBytes': old['headerSize'],
            'candidateHeaderBytes': new['headerSize'], 'baselineMaxStack': old['maxStack'], 'candidateMaxStack': new['maxStack']})
    comparison['methods'] = methods
    comparison['headerBytes'] = change(sum(row['headerSize'] for row in baseline['methods']), sum(row['headerSize'] for row in candidate['methods']))
    comparison['tinyMethods'] = sum(row['headerSize'] == 1 for row in candidate['methods'])
    comparisons[workload] = comparison

capture = json.loads((EXECUTION / 'native-first/capture.json').read_bytes())
native_methods = {row['name']: row for row in capture['observations']['compiler']['observed']['methods']}
analyses = {row['name']: row['analysis'] for row in capture['observations']['compiler']['results']}
for method in reports['candidate-corpus']['methods']:
    native = native_methods[method['name']]
    assert hashlib.sha256(bytes.fromhex(native['codeHex'])).hexdigest() == method['codeSHA256']
    for key in ['maxStack', 'headerSize', 'localSignature', 'initLocals', 'handlers']:
        assert native[key] == method[key]
    analysis = analyses[method['name']]
    assert analysis['status'] == 'complete' and not analysis['diagnostics']
    assert method['maxStack'] == (8 if method['headerSize'] == 1 else analysis['maxStack'])

review = {'format': 'sharpforge.method-header.independent-qualification-review', 'version': 1,
    'reviewedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'plan': identity(PLAN_PATH),
    'candidateHead': PLAN['candidateHead'], 'baselineHead': PLAN['baselineHead'], 'originalProductHead': PLAN['originalProductHead'],
    'sourceToolIdentitiesReverified': True, 'sourceFiles': 2457, 'toolFiles': 414, 'aliasesPerCheckout': 10,
    'snapshots': snapshot_records, 'sourceArchiveEntriesVerified': 2461, 'machine': machine, 'executionOrder': ORDER,
    'receipts': receipts, 'cohorts': cohorts, 'comparisons': comparisons,
    'counts': {'freshBenchmarkProcesses': 4, 'firstCompilations': 4, 'warmupCompilations': 80, 'measuredCompilations': 400,
               'totalChronologicalCompilations': 484},
    'guards': ['All child qualified flags and successful exits retained; byte-determinism assertions ran outside timers on every subsequent compile.',
        'All chronological timings and heap deltas retained; all published timing summaries recomputed from final 100 samples.',
        'Raw stdout JSON equals each saved benchmark report.', 'All control/corpus IL hashes, code sizes, tokens, local signatures and EH clauses match baseline.',
        'All 13 candidate corpus header fields and IL hashes match the retained native SRM observation and complete maxstack analyses.',
        'All seven qualification steps share identical source/tool/alias snapshots, with clean exact heads before and after.'],
    'historicalEvidencePinsReverified': list(history_pins.values()),
    'performanceDisposition': 'Pending independent coordinator decision. Corpus median/p95/p99 regressions exceed 5%; no performance pass or sign-off is claimed.',
    'correctnessCostAnalysis': [
        'The direct emitter now analyzes the completed, relaxed IL graph using canonical decoding, EH validation and bounded dataflow, with authoritative variable effects by final opcode offset. This introduces per-method graph work beyond eager emitter depth tracking.',
        'That extra work is a plausible source of corpus time and heap-delta increases, but this whole-checkout comparison does not isolate a causal cost for one function or for tiny-header encoding.',
        'The corpus changes seven of thirteen methods to one-byte tiny headers, reducing summed method-header bytes from 156 to 79. Controls change all three headers, from 36 to 3 bytes. PE files remain 2560/1536 bytes because these savings do not reduce the retained file extent.',
        'Patterns retains identical IL and EH data while its fat maxstack changes from 5 to the final-graph bound 3. DeepCall remains fat with bound 10; locals, EH and dynamic-allocation cases preserve fat initialization semantics.',
        'Tiny maxstack is implicitly 8, even when the computed peak is lower. These observations establish encoding/correctness behavior, not an automatic waiver of performance regression.'],
    'limitations': [
        'One fresh process per variant/workload, fixed serial order, team quiet window and no competing workload observed in preflight. Host/cache/scheduler variation remains possible; no repeated-cohort inference or causal speedup claim.',
        'Import and first-compilation observations are single samples. HeapUsed differences include temporary objects and do not measure allocation rate, retained heap or peak memory.',
        'Per-iteration assemblies were checked by the pinned child driver but not stored individually. The reports retain first-result assembly hashes and method guards; independent review cannot replay discarded per-call assemblies.',
        PLAN['refoutProvenanceLimit'],
        'This batch is the additive core/direct compiler portion; legacy emitter/replay integration and inherited schema qualification remain outside scope. Issue 2391 is not closed by these measurements.'],
    'reruns': 0, 'rootPerformanceSignoff': False, 'sourceOrHarnessMutationsDuringMeasurements': False}
review_path = ROOT / 'method-header-qualification-review-3ddd6460.json'
save_exclusive(review_path, review)

lines = ['The frozen method-header batch passed native correctness, reference-output compatibility, and the original 13-file gate (79/79). '
         'Four original benchmark processes then completed once each with exact source/tool pins unchanged. Performance acceptance remains pending: '
         'the corpus measured median increased 14.09%, p95 8.93%, and p99 10.27%. No sign-off or performance-pass claim is made.', '',
         'Candidate: `3ddd6460260d93f0a5258bd84ac62158e36dce10` (product bytes unchanged from `3316898e`); '
         'baseline: `e60b0764782f1122439e5b161cb9494c75724e32`. Node 24.19.0, Linux x64, AMD EPYC 9V74, '
         '9 reported logical CPUs, 10,451,464,192 bytes reported memory. The four runs occurred serially within the coordinated quiet window '
         'from 20:45:53 to 20:46:45 UTC on 2026-10-04.', '',
         '| Workload / metric | Baseline | Candidate | Change |', '|---|---:|---:|---:|']
for workload in ['controls', 'corpus']:
    comparison = comparisons[workload]
    for label, metric in [('Import, ms (one sample)', comparison['compilerImportMs']),
                          ('First compile, ms (one sample)', comparison['firstCompileMs']),
                          *[(key + ' compile, ms', comparison['measuredCompileMs'][key]) for key in ['median', 'mean', 'p95', 'p99', 'min', 'max']]]:
        lines.append(f"| {workload} / {label} | {metric['baseline']:.6f} | {metric['candidate']:.6f} | {metric['changePercent']:+.2f}% |")
lines += ['', 'Each process retained 121 chronological compilations: first, 20 warmups, and 100 measured. '
          'The median is the middle-pair average; p95/p99 are nearest-rank samples 95/99. Compiler import is separate. '
          'Every compilation checks success and subsequent assembly-byte equality outside the timer. '
          'All 484 timing and heap observations remain in the original reports.', '',
          '| Workload / measured heap delta | Baseline bytes | Candidate bytes | Change |', '|---|---:|---:|---:|']
for workload in ['controls', 'corpus']:
    for key in ['median', 'mean', 'p95', 'p99', 'min', 'max']:
        metric = comparisons[workload]['measuredHeapUsedDeltaBytes'][key]
        lines.append(f"| {workload} / {key} | {metric['baseline']:,.2f} | {metric['candidate']:,.2f} | {metric['changePercent']:+.2f}% |")
lines += ['', 'GC was exposed and requested before each compile. Heap deltas include temporary objects; these figures are not allocation-rate, '
          'retained-heap, or peak-memory measurements. The corpus slowdown is present across all four chronological 25-sample quarters '
          '(baseline medians 14.184478, 14.152030, 14.987939, 13.441677 ms; candidate 16.265956, 16.539018, 15.762767, 16.337361 ms). '
          'Import and first-compile movement is mixed, and their single observations cannot establish a distribution.', '',
          'The completed relaxed IL now receives a canonical, bounded graph analysis after eager emitter checks. '
          'This added per-method work is a plausible correctness cost, but the whole-checkout comparison does not isolate its causal contribution. '
          'The adverse corpus distribution requires explicit coordinator review under the project performance budget.', '',
          'All three control methods and seven of thirteen corpus methods use tiny headers. Summed header bytes change from 36 to 3 '
          'and from 156 to 79 respectively; the complete PE files remain 1,536 and 2,560 bytes. All method IL hashes, local-signature tokens, '
          'code lengths and EH clauses match their baselines. The unchanged `Patterns` IL now has exact fat maxstack 3 instead of 5; '
          '`DeepCall` retains fat maxstack 10, and local/EH/dynamic-allocation methods retain fat initialization. '
          'All thirteen candidate corpus method observations match the retained native SRM record and complete maxstack analysis.', '',
          'Correctness evidence includes four pinned probes plus seven native workload commands, Roslyn/compiler execution comparison, '
          'six valid ILAsm/body-writer boundaries, two native invalid-program cases, unchanged public/friend reference-output compatibility, '
          'and the 79/79 focused gate. The unchanged refout driver discards successful non-consumer subprocess output and deletes its temporary '
          'workspace; retained outer logs cannot recover that missing inner provenance.', '',
          'Earlier evidence is preserved: the adapter test passed 1/1 while its original recorder failed to parse the Node spec reporter; '
          'three native attempts failed on observer/fixture issues (nil SRM token normalization, platform ILAsm arguments/local identifier, '
          'and ILAsm maxstack policy). Their original statuses, raw logs and source snapshots remain alongside corrected tool-only attempts. '
          'The earlier benchmark readiness failure and partial source archive remain unchanged. No benchmark cohort was retried.', '',
          'Legacy emitter/replay integration and inherited schema qualification remain outside this batch; issue #2391 remains open. '
          'These results cover the recorded Linux/CoreCLR environment. Native success does not establish cross-platform qualification.', '',
          'Exact invocation arguments, public environment settings, timing boundaries, raw output hashes and full distributions are in '
          '`method-header-qualification-review-3ddd6460.json`. The additive retention manifest maps every original evidence file to an exact '
          'repository-relative destination without modifying the originals.']
markdown_path = ROOT / 'method-header-qualification-review-3ddd6460.md'
with markdown_path.open('x') as stream:
    stream.write('\n'.join(lines) + '\n')

files = []
for path in sorted(ROOT.glob('method-header*')):
    assert not path.is_symlink()
    leaves = sorted(path.rglob('*')) if path.is_dir() else [path]
    for leaf in leaves:
        assert not leaf.is_symlink()
        if leaf.is_file():
            row = identity(leaf)
            row['relativePath'] = str(leaf.relative_to(ROOT))
            row['retainAs'] = 'tests/fixtures/a03-method-headers/qualification/' + row['relativePath']
            row['disposition'] = 'retain exact original bytes; preserve original success/failure status'
            files.append(row)
assert len({row['relativePath'] for row in files}) == len(files)
manifest = {'format': 'sharpforge.method-header.retention-manifest', 'version': 1,
    'createdUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'mode': 'prepared-not-copied-or-committed',
    'scope': 'All method-header-prefixed evidence files and directories in this task scratch, including originals and historical failures.',
    'files': files, 'fileCount': len(files), 'totalBytes': sum(row['bytes'] for row in files),
    'qualificationReview': identity(review_path), 'prReadyReport': identity(markdown_path),
    'excludes': ['This manifest itself, to avoid a circular self hash.', 'No active worktree or installed tool binaries are copied by this manifest.'],
    'sourceOrEvidenceDeleted': False, 'productOrHarnessExecution': False, 'rootPerformanceSignoff': False}
manifest_path = ROOT / 'method-header-retention-manifest-3ddd6460.json'
save_exclusive(manifest_path, manifest)
print(json.dumps({'review': identity(review_path), 'report': identity(markdown_path), 'manifest': identity(manifest_path),
                  'retentionFiles': len(files), 'retentionBytes': manifest['totalBytes'], 'historicalPins': len(history_pins)}, indent=2))
