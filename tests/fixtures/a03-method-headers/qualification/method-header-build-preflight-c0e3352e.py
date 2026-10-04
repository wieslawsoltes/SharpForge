"""Read frozen worktrees and write the external maxstack qualification preparation."""

import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile


ROOT = Path('/workspace/scratch/7e3d2a445c44')
ORIGINAL = '3316898efee4a9d23b8e0cb87919b9de28a1084a'
CANDIDATE = 'c0e3352e0d68298c5e9653b3e118c28453a193ef'
BASELINE = 'e60b0764782f1122439e5b161cb9494c75724e32'
PACKAGES = ['archive', 'bcl-collections', 'bcl-core', 'bytecode', 'cil', 'compiler',
            'framework', 'symbols', 'syntax', 'text']
ENVIRONMENT = dict(os.environ, GIT_OPTIONAL_LOCKS='0')


def digest(path):
    state = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            state.update(chunk)
    return state.hexdigest()


def describe(path):
    path = Path(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest(path)}


def git(checkout, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args], cwd=checkout, env=ENVIRONMENT)


def text_git(checkout, *args):
    return git(checkout, *args).decode().strip()


def write_json(path, value):
    with Path(path).open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def checkout_snapshot(checkout, head, paths):
    assert text_git(checkout, 'rev-parse', 'HEAD') == head
    assert not text_git(checkout, 'status', '--porcelain', '--untracked-files=all')
    rows, blobs = [], []
    for raw in git(checkout, 'ls-tree', '-r', '-z', 'HEAD', '--', *paths).split(b'\0'):
        if not raw:
            continue
        header, path = raw.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        relative = path.decode()
        source = checkout / relative
        assert kind == 'blob' and mode in ['100644', '100755'] and source.is_file()
        data = source.read_bytes()
        assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == oid
        rows.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        blobs.append({'path': relative, 'blob': oid})
    aliases = []
    for package in PACKAGES:
        alias = checkout / 'node_modules/@sharpforge' / package
        assert alias.is_symlink() and alias.resolve() == checkout / 'packages' / package
        assert (alias / 'src/index.js').is_file()
        manifest = json.loads((alias / 'package.json').read_text())
        assert manifest['name'] == '@sharpforge/' + package
        for dependency in manifest.get('dependencies', {}):
            assert dependency.startswith('@sharpforge/') and dependency.split('/')[1] in PACKAGES
        aliases.append({'name': package, 'target': os.readlink(alias), 'resolved': str(alias.resolve())})
    return {'path': str(checkout), 'head': head, 'tree': text_git(checkout, 'rev-parse', 'HEAD^{tree}'),
            'aliases': aliases, 'files': rows, 'committedBlobs': blobs}


def main():
    original_path = ROOT / 'method-header-preparation-3316898e.json'
    bounds_path = ROOT / 'method-header-source-bounds.json'
    original = json.loads(original_path.read_text())
    assert digest(original_path) == '015aed88a13998ef82d602a4ba0d60f2ade650de0dbc44cf4270f16914f552ed'
    assert digest(bounds_path) == 'cac0d12d3f3db2f4b3408381c80458574ed651d529c871f7919e15a24c167161'
    candidate = Path(original['cwd'])
    baseline = Path(original['baselineCwd'])
    common = ['package.json', 'CONTRIBUTING.md']
    for package in PACKAGES:
        common.extend([f'packages/{package}/src', f'packages/{package}/package.json'])
    selected = common + list(original['sourceSha256']) + original['focusedArgv'][4:] + [
        'packages/cil/tools', 'tests/fixtures/a03-method-headers', 'tests/fixtures/a03-reference-assemblies',
        'tests/fixtures/eh-encoding', 'tests/support/exception-encoding.js', 'tests/a03-05-header-capture.test.js',
        'scripts/limited.js', 'scripts/planning/lib/resource-limits.js', 'scripts/conformance/oracle/toolchain.js',
        'scripts/conformance/oracle/process.js', 'planning/qualification/oracle-toolchain.json',
        'planning/qualification/suites/ilasm-pins.json',
    ]
    checkouts = {'candidate': checkout_snapshot(candidate, CANDIDATE, selected),
                 'baseline': checkout_snapshot(baseline, BASELINE, common)}
    pins = json.loads((candidate / 'planning/qualification/oracle-toolchain.json').read_text())
    assembler_pins = json.loads((candidate / 'planning/qualification/suites/ilasm-pins.json').read_text())
    dotnet_root = Path(original['environment']['DOTNET_ROOT'])
    node = Path(shutil.which('node')).resolve()
    tool_paths = {node, Path(original['environment']['DOTNET']), Path(original['environment']['SHARPFORGE_ILASM'])}
    tool_directories = [dotnet_root / 'sdk' / pins['sdk'] / 'Roslyn/bincore',
                        dotnet_root / 'shared/Microsoft.NETCore.App' / pins['runtime'],
                        dotnet_root / 'host/fxr' / pins['runtime']]
    for directory in tool_directories:
        tool_paths.update(path for path in directory.rglob('*') if path.is_file())
    reference_directory = dotnet_root / 'packs/Microsoft.NETCore.App.Ref' / pins['referencePack'] / 'ref' / pins['targetFramework']
    references = sorted(reference_directory.glob('*.dll'))
    tool_paths.update(references)
    reference_rows = [{'name': path.name, 'sha256': digest(path)} for path in references]
    aggregate = hashlib.sha256(json.dumps(reference_rows, separators=(',', ':')).encode()).hexdigest()
    assert len(references) == pins['referenceAssemblies']['count'] == 167
    assert aggregate == pins['referenceAssemblies']['sha256']
    csc = tool_directories[0] / 'csc.dll'
    assert digest(csc) == pins['roslyn']['platformHashes']['linux-x64']
    ilasm = Path(original['environment']['SHARPFORGE_ILASM'])
    expected_ilasm = next(item for item in assembler_pins['platforms'] if item['rid'] == 'linux-x64')
    assert digest(ilasm) == expected_ilasm['sha256']
    execution = ROOT / 'method-header-qualification-c0e3352e'
    assert not execution.exists()
    steps = {}
    def add(identifier, argv, output=None, after=(), timeout=900, minimum=384 * 1024 * 1024, original_argv=None):
        assert argv[:3] == ['node', 'scripts/limited.js', 'node']
        if output:
            assert not Path(output).exists()
        steps[identifier] = {'id': identifier, 'cwd': str(candidate), 'argv': argv,
                             'originalArgv': original_argv or argv, 'after': list(after),
                             'timeoutSeconds': timeout, 'minimumFreeBytes': minimum}
        if output:
            steps[identifier]['output'] = str(output)
    add('adapter', ['node', 'scripts/limited.js', 'node', '--test', 'tests/a03-05-header-capture.test.js'],
        timeout=120, minimum=64 * 1024 * 1024)
    native = list(original['nativeArgv'])
    native[-1] = str(execution / 'native-first')
    add('native', native, native[-1], ['adapter'], original_argv=original['nativeArgv'])
    refout = list(original['refoutArgv'])
    refout[-1] = str(execution / 'refout-first')
    add('refout', refout, refout[-1], ['native'], original_argv=original['refoutArgv'])
    add('focused', list(original['focusedArgv']), after=['refout'], timeout=600, minimum=128 * 1024 * 1024)
    previous = 'focused'
    driver_sha = original['sourceSha256']['packages/cil/tools/benchmark-method-headers.mjs']
    for item in original['benchmarks']:
        argv = list(item['argv'])
        identifier = item['id']
        add(identifier, argv, item['output'], [previous], timeout=600, minimum=128 * 1024 * 1024)
        side, workload = identifier.split('-')
        steps[identifier]['benchmark'] = {'compilerRevision': BASELINE if side == 'baseline' else CANDIDATE,
            'headerMode': 'legacy' if side == 'baseline' else 'auto', 'workload': workload,
            'compilerEntry': argv[argv.index('--compiler') + 1], 'driverSHA256': driver_sha,
            'sourceSHA256': original['sourceSha256'][f'tests/fixtures/a03-method-headers/{workload}.cs']}
        previous = identifier
    product_trees = []
    for package in PACKAGES:
        path = f'packages/{package}/src'
        before = text_git(candidate, 'rev-parse', ORIGINAL + ':' + path)
        after = text_git(candidate, 'rev-parse', CANDIDATE + ':' + path)
        assert before == after
        product_trees.append({'path': path, 'original': before, 'candidate': after, 'unchanged': True})
    original_pin_comparison = []
    for path, expected in original['sourceSha256'].items():
        committed_original = git(candidate, 'show', ORIGINAL + ':' + path)
        assert hashlib.sha256(committed_original).hexdigest() == expected
        actual = digest(candidate / path)
        original_pin_comparison.append({'path': path, 'originalSha256': expected, 'candidateSha256': actual,
                                        'unchanged': actual == expected})
    changed = text_git(candidate, 'diff', '--name-only', ORIGINAL, CANDIDATE).splitlines()
    assert changed == ['scripts/conformance/oracle/toolchain.js', 'tests/a03-05-header-capture.test.js',
                       'tests/fixtures/a03-method-headers/README.md', 'tests/fixtures/a03-method-headers/capture.mjs',
                       'tests/fixtures/a03-method-headers/process-capture.mjs']
    unchanged = ['packages/cil/tools/capture-reference-assemblies.mjs', 'packages/cil/tools/reference-consumers.mjs',
                 'packages/cil/tools/benchmark-method-headers.mjs', 'tests/fixtures/a03-reference-assemblies',
                 'tests/fixtures/a03-method-headers/Program.cs', 'tests/fixtures/a03-method-headers/input.js',
                 'tests/fixtures/a03-method-headers/corpus.cs', 'tests/fixtures/a03-method-headers/controls.cs']
    for path in unchanged:
        assert text_git(candidate, 'rev-parse', ORIGINAL + ':' + path) == text_git(candidate, 'rev-parse', CANDIDATE + ':' + path)
    archive = ROOT / 'method-header-source-snapshots-c0e3352e.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for side, checkout in checkouts.items():
            for row in checkout['files']:
                info = zipfile.ZipInfo(side + '/' + row['path'], date_time=(2026, 10, 4, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                output.writestr(info, (Path(checkout['path']) / row['path']).read_bytes())
        for path in ['tests/fixtures/a03-method-headers/capture.mjs', 'tests/fixtures/a03-method-headers/README.md']:
            output.writestr('original331/' + path, git(candidate, 'show', ORIGINAL + ':' + path))
        output.writestr('original331/preparation.json', original_path.read_bytes())
        output.writestr('original331/source-bounds.json', bounds_path.read_bytes())
    infrastructure = ROOT / 'method-header-infrastructure-3316898e.json'
    environment = dict(original['environment'], SHARPFORGE_MAX_PARALLEL_RUNS='1',
                       SHARPFORGE_TEST_CONCURRENCY='1', SHARPFORGE_MAX_OLD_SPACE_MB='2048', GIT_OPTIONAL_LOCKS='0')
    limit = ('Unchanged compatibility driver: consumer compiler argv/stdout/stderr/status and native observations are retained; '
             'successful non-consumer execFileSync stdout/stderr and its finally-deleted temporary build workspace are unavailable. '
             'Outer stdout/stderr, exact invocation, times, source inventories, and produced files are retained externally. '
             'No claim of complete inner-process provenance applies to this compatibility step.')
    plan = {'schema': 1, 'status': 'prepared-unexecuted; root must explicitly grant the sole heavy slot',
            'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'originalProductHead': ORIGINAL,
            'candidateHead': CANDIDATE, 'baselineHead': BASELINE, 'checkouts': checkouts,
            'executionDirectory': str(execution), 'nodeExecutable': str(node), 'environment': environment,
            'publicEnvironmentNames': ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'CI', 'GITHUB_ACTIONS', 'NODE_OPTIONS',
                'DOTNET_ROOT', 'DOTNET', 'SHARPFORGE_ORACLE_DOTNET', 'SHARPFORGE_ILASM', 'DOTNET_ROLL_FORWARD',
                'DOTNET_ROLL_FORWARD_TO_PRERELEASE', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'DOTNET_NOLOGO',
                'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_OLD_SPACE_MB', 'GIT_OPTIONAL_LOCKS'],
            'toolFiles': [describe(path) for path in sorted(tool_paths)],
            'referenceAssemblyIdentity': {'count': len(references), 'sha256': aggregate, 'files': reference_rows},
            'toolchainExpected': {'sdk': pins['sdk'], 'runtime': pins['runtime'], 'roslynSha256': digest(csc),
                                  'ilasmSha256': digest(ilasm), 'runtimeVersionObservedNow': False},
            'immutablePreparationFiles': [describe(original_path), describe(bounds_path), describe(infrastructure)],
            'sourceArchive': describe(archive), 'steps': steps, 'refoutProvenanceLimit': limit,
            'benchmarkPolicy': original['benchmarkPolicy'],
            'sourceChanges': {'seamCommit': text_git(candidate, 'rev-parse', CANDIDATE + '^'),
                              'seamSourceCommit': '53bfa5a3cc36d4a2f0f6ef6bb7180ac1094e1617',
                              'captureCommit': CANDIDATE, 'paths': changed, 'productTrees': product_trees,
                              'originalPinComparison': original_pin_comparison, 'unchangedToolAndFixturePaths': unchanged},
            'executionPolicy': 'One prepared step per invocation; no automatic retries, changed inputs, aliases, installs or publication. '
                'Each step has exclusive logs and fresh outputs, and checks all source/fixture/tool hashes before and after. '
                'Only native/refout output destinations are redirected outside the worktree; the 13-file gate and four benchmark argv are unchanged. '
                'The added adapter failure test is a separately recorded prerequisite. '
                'Native logs retain the canonical runner UTF-8 strings, including error.result on failure, within canonical limits.',
            'coverageLimits': original['readiness']}
    plan_path = ROOT / 'method-header-preflight-c0e3352e.json'
    write_json(plan_path, plan)
    recorder = ROOT / 'method-header-run-step-c0e3352e.py'
    source = recorder.read_text()
    assert source.count('REPLACE_AFTER_PLAN_CREATION') == 1
    source = source.replace('REPLACE_AFTER_PLAN_CREATION', digest(plan_path))
    ast.parse(source, filename=str(recorder))
    recorder.write_text(source)
    receipt = {'schema': 1, 'status': 'source-only preparation complete; no product imports or qualification executed',
               'candidateHead': CANDIDATE, 'candidateTree': checkouts['candidate']['tree'], 'baselineHead': BASELINE,
               'plan': describe(plan_path), 'recorder': describe(recorder), 'sourceArchive': describe(archive),
               'infrastructure': describe(infrastructure), 'builder': describe(__file__),
               'changedPaths': changed, 'toolOnlyDiff': git(candidate, 'diff', ORIGINAL, CANDIDATE).decode(),
               'productTreesUnchanged': product_trees, 'originalPins': original_pin_comparison,
               'adapterFailureCoverageReason': 'Existing EH tests exercise toolchain forwarding and finishCapture, but do not execute '
                   'this new header process-recorder persistence path. One focused fake-runner rejection test retains admitted commands, '
                   'partial output, status, hashes and original error identity; actual native capture will exercise success.',
               'refoutProvenanceLimit': limit, 'syntaxCheckedWithoutExecution': str(recorder),
               'sourceSnapshotCounts': {side: {'files': len(checkout['files']), 'bytes': sum(row['bytes'] for row in checkout['files'])}
                                        for side, checkout in checkouts.items()},
               'toolSnapshotFiles': len(plan['toolFiles']), 'diskFreeBytes': shutil.disk_usage(ROOT).free}
    receipt_path = ROOT / 'method-header-preparation-c0e3352e.json'
    write_json(receipt_path, receipt)
    print(json.dumps({'receipt': describe(receipt_path), 'plan': describe(plan_path), 'recorder': describe(recorder),
                      'sourceArchive': describe(archive), 'sourceSnapshots': receipt['sourceSnapshotCounts'],
                      'toolFiles': len(plan['toolFiles']), 'stepIds': list(steps), 'diskFreeBytes': receipt['diskFreeBytes']}, indent=2))


if __name__ == '__main__':
    main()
