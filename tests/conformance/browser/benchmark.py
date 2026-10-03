"""Measure the launcher, including tracing overhead, with correctness assertions."""
from pathlib import Path
import argparse
import json
import math
import sys
import time
import tracemalloc

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests'))
from conformance.browser.launch import launch_browser, results_dir


def distribution(samples):
    ordered = sorted(samples)
    return {'samples': len(samples), 'milliseconds': samples,
            'p95': ordered[math.ceil(len(samples) * .95) - 1],
            'p99': ordered[math.ceil(len(samples) * .99) - 1]}


def benchmark(iterations):
    from playwright.sync_api import sync_playwright
    cold, warm = [], []
    tracemalloc.start()
    with sync_playwright() as p:
        for index in range(3):
            start = time.perf_counter()
            with launch_browser(p, 'launcher-benchmark-' + str(index)) as browser:
                page = browser.new_page()
                assert page.evaluate('6 * 7') == 42
                cold.append((time.perf_counter() - start) * 1000)
                for _ in range(iterations):
                    start = time.perf_counter()
                    page.set_content('<h1>Warm page</h1>')
                    assert page.locator('h1').inner_text() == 'Warm page'
                    warm.append((time.perf_counter() - start) * 1000)
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    report = {'coldLaunchToCorrectEvaluation': distribution(cold),
              'warmDocumentAndCorrectAssertion': distribution(warm),
              'pythonAllocationBytes': {'current': current, 'peak': peak},
              'scope': 'Real Chromium launcher and Python harness, with tracing enabled. Python allocations exclude Chromium process memory. Three cold samples and small warm samples are diagnostic, not a statistical performance gate.'}
    (results_dir() / 'launcher-performance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iterations', type=int, default=10)
    args = parser.parse_args()
    if not 3 <= args.iterations <= 200:
        parser.error('--iterations must be between 3 and 200')
    benchmark(args.iterations)
