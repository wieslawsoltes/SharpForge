"""Pair the unchanged constructor benchmark with a bounded fresh-callback admission measurement."""

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import time

CONSTRUCTOR = 'packages/runtime/bench/cil-async.mjs'
CALLBACK = 'packages/runtime/bench/cil-admission-callback.mjs'
FIXTURE = 'tests/managed-fixtures.js'
HELPER = 'packages/runtime/bench/cil-async-paired.py'
SOURCE_LIMIT = 32 * 1024 * 1024
REPORT_LIMIT = 8 * 1024 * 1024
MINIMUM_FREE = 128 * 1024 * 1024
MAX_WALL_SECONDS = 120


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(repository, *args):
    return subprocess.check_output(['git', '-C', str(repository), *args])


def save(target, report):
    encoded = (json.dumps(report, indent=2) + '\n').encode()
    if len(encoded) > REPORT_LIMIT:
        raise RuntimeError('Performance report exceeded its explicit 8 MiB bound')
    pending = target.with_suffix('.pending')
    pending.write_bytes(encoded)
    pending.replace(target)


def enough_space(directory, minimum=MINIMUM_FREE):
    if shutil.disk_usage(directory).free < minimum:
        raise RuntimeError('Insufficient free space for the bounded performance run')


def numeric_measurement(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and value >= 0


def validate_result(result, driver):
    name = 'ordinary-no-async' if driver == CONSTRUCTOR else 'late-callback-finally'
    duration = 'executionMs' if driver == CONSTRUCTOR else 'callbackMs'
    keys = ['admissionMs', duration, 'totalMs', 'allocatedBytes', 'allocations']
    if result.get('warmups') != 80 or result.get('samples') != 24:
        raise RuntimeError('Benchmark changed the fixed warmup/sample policy')
    cases = result.get('cases')
    if not isinstance(cases, list) or len(cases) != 1 or cases[0].get('name') != name or cases[0].get('status') != 'measured':
        raise RuntimeError('Benchmark returned an unexpected or unmeasured workload')
    case = cases[0]
    samples = case.get('samples')
    if not isinstance(samples, list) or len(samples) != 24:
        raise RuntimeError('Benchmark did not retain all 24 raw observations')
    for index, sample in enumerate(samples):
        for key in keys:
            if not isinstance(sample, dict) or not numeric_measurement(sample.get(key)):
                raise RuntimeError(f'{name} sample {index} has an invalid {key} measurement')
    for key in keys:
        metric = case.get('metrics', {}).get(key, {})
        if not all(numeric_measurement(metric.get(statistic)) for statistic in ['median', 'p95']):
            raise RuntimeError(name + ' has an invalid summary for ' + key)


def compare(helper, runs):
    summary = helper.summaries(runs)
    for name in ['ordinary-no-async', 'late-callback-finally']:
        entries = [entry for entry in summary if entry['name'] == name]
        if len(entries) != 2 or any(entry['status'] != 'measured' or entry['sampleCount'] != 48 for entry in entries):
            raise RuntimeError('Incomplete paired workload: ' + name)
        if entries[0]['assemblySha256'] != entries[1]['assemblySha256']:
            raise RuntimeError('The two versions did not measure the same PE: ' + name)
    comparisons = helper.comparisons(summary)
    for entry in comparisons:
        for metric in entry['metrics'].values():
            baseline, candidate = metric['baseline']['p95'], metric['candidate']['p95']
            metric['p95PercentChange'] = (candidate / baseline - 1) * 100 if baseline else None
    return summary, comparisons


def prepare(helper, options, root, report):
    payloads = {
        CONSTRUCTOR: git(options.repository, 'show', options.candidate + ':' + CONSTRUCTOR),
        CALLBACK: (Path(__file__).parent / 'callback.mjs').read_bytes(),
        FIXTURE: git(options.repository, 'show', options.candidate + ':' + FIXTURE),
    }
    report['benchmarkSources'] = {path: {'bytes': len(data), 'sha256': digest(data)} for path, data in payloads.items()}
    exports = {}
    for label, commit in [('A', options.baseline), ('B', options.candidate)]:
        report['stage'] = 'export ' + label
        enough_space(options.output.parent)
        directory = root / label
        inventory = helper.export_sources(options.repository, commit, directory, [])
        if inventory['bytes'] > SOURCE_LIMIT:
            raise RuntimeError('Runtime export exceeds 32 MiB')
        for path, data in payloads.items():
            target = directory / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            inventory['files'].append({'path': path, 'bytes': len(data), 'sha256': digest(data)})
        exports[label] = (directory, inventory)
        report['sources'][label] = inventory
        save(options.output, report)
    return exports


def measure(helper, options, root, report):
    exports = prepare(helper, options, root, report)
    started = time.monotonic()
    for label in report['order']:
        directory, inventory = exports[label]
        for driver in [CONSTRUCTOR, CALLBACK]:
            enough_space(options.output.parent)
            helper.verify_export(directory, inventory)
            remaining = MAX_WALL_SECONDS - (time.monotonic() - started)
            if remaining <= 0:
                raise RuntimeError('Performance run exceeded its 120-second measurement bound')
            report['stage'] = 'measure ' + label + ' ' + driver
            measured = helper.run(directory, [driver], inventory['commit'], timeout=min(30, remaining))
            measured.update(revision=label, driver=driver)
            report['runs'].append(measured)
            save(options.output, report)
            helper.verify_export(directory, inventory)
            if measured['exitCode']:
                raise RuntimeError('Benchmark process failed; its complete output is retained')
            measured['result'] = json.loads(measured['stdout'])
            validate_result(measured['result'], driver)
            save(options.output, report)
    report['summary'], report['comparisons'] = compare(helper, report['runs'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    options.repository = options.repository.resolve()
    options.output = options.output.resolve()
    if options.output.exists():
        raise RuntimeError('Refusing to replace a previous performance result')
    options.output.parent.mkdir(parents=True, exist_ok=True)
    enough_space(options.output.parent, 256 * 1024 * 1024)
    report = {'baseline': options.baseline, 'candidate': options.candidate, 'order': ['A', 'B', 'B', 'A'],
              'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'environment': {'platform': platform.platform(), 'cpus': os.cpu_count(),
                              'loadAverage': os.getloadavg() if hasattr(os, 'getloadavg') else None},
              'sources': {}, 'runs': [], 'stage': 'prepare benchmark helper'}
    save(options.output, report)
    try:
        with tempfile.TemporaryDirectory(prefix='cil-admission-perf-', dir=options.output.parent) as temporary:
            root = Path(temporary)
            helper_bytes = git(options.repository, 'show', options.candidate + ':' + HELPER)
            helper_path = root / 'async_pair_support.py'
            helper_path.write_bytes(helper_bytes)
            report['existingHelperSha256'] = digest(helper_bytes)
            specification = importlib.util.spec_from_file_location('async_pair_support', helper_path)
            helper = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(helper)
            helper.revision(options.repository, options.baseline)
            helper.revision(options.repository, options.candidate)
            measure(helper, options, root, report)
        report['stage'] = 'complete'
    except Exception as error:
        report['failure'] = {'name': type(error).__name__, 'message': str(error), 'stage': report['stage']}
    finally:
        report['endingLoadAverage'] = os.getloadavg() if hasattr(os, 'getloadavg') else None
        save(options.output, report)
    print(json.dumps({'output': str(options.output), 'runs': len(report['runs']), 'failure': report.get('failure')}, indent=2))
    return 1 if report.get('failure') else 0


if __name__ == '__main__':
    raise SystemExit(main())
