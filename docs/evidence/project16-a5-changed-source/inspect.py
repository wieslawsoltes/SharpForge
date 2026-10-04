"""Bounded inspection of the recorded Git range; does not execute repository code."""
import ast
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import re
import subprocess
import sys


BASE = 'c13aa0fd9d27df28b3708bb83d914a04c20a5c7c'
SOURCE = 'e89257052957f4c736512e9c2b46162bb6f23eae'
TREE = '9e33eca9a91361201b2e14fea3cded5cbd584d88'
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).resolve().parent
LIMITS = {'lines': 500, 'bytes': 40000, 'lineLength': 160}
OFFICIAL_ROOTS = {'packages', 'apps', 'scripts', 'rust'}
OFFICIAL_EXTENSIONS = {'.js', '.mjs', '.rs', '.css'}
IGNORED = re.compile(r'(^|/)(node_modules|dist|artifacts|target|vendor|generated|fixtures)(/|$)|\.min\.|\.generated\.')
commands = []


def git(*args):
    command = ['git', *args]
    commands.append(command)
    return subprocess.check_output(command, cwd=ROOT)


def blob(revision, path):
    return git('show', revision + ':' + path)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def width(text):
    return len(text.encode('utf-16-le')) // 2


def measure(data):
    lines = data.decode('utf-8').split('\n')
    return {'lines': len(lines), 'bytes': len(data), 'lineLength': max(map(width, lines), default=0)}


started = datetime.now(timezone.utc).isoformat()
actual_tree = git('rev-parse', SOURCE + '^{tree}').decode().strip()
if actual_tree != TREE:
    raise RuntimeError('Recorded source tree does not match the inspection target')
paths = git('diff', '--name-only', '--diff-filter=AM', '-z', BASE, SOURCE).decode().split('\0')[:-1]
source_paths = [path for path in paths if Path(path).suffix in OFFICIAL_EXTENSIONS | {'.py'}]
policy_paths = ['CONTRIBUTING.md', 'scripts/quality/check-structure.js', 'scripts/quality/structure-baseline.json']
policies = {path: blob(SOURCE, path) for path in policy_paths}
baseline_path = policy_paths[-1]
baseline = json.loads(policies[baseline_path])
baseline_unchanged = blob(BASE, baseline_path) == policies[baseline_path]
rows = []
violations = []
for path in source_paths:
    current = blob(SOURCE, path)
    old_exists = subprocess.run(['git', 'cat-file', '-e', BASE + ':' + path], cwd=ROOT, capture_output=True).returncode == 0
    commands.append(['git', 'cat-file', '-e', BASE + ':' + path])
    previous = blob(BASE, path) if old_exists else None
    metrics = measure(current)
    before = measure(previous) if previous is not None else None
    official = path.split('/')[0] in OFFICIAL_ROOTS and Path(path).suffix in OFFICIAL_EXTENSIONS and not IGNORED.search(path)
    historical = baseline['files'].get(path)
    prior_lines = Counter(previous.decode('utf-8').split('\n') if previous is not None else [])
    introduced = []
    for number, line in enumerate(current.decode('utf-8').split('\n'), 1):
        if prior_lines[line]:
            prior_lines[line] -= 1
        elif width(line) > LIMITS['lineLength']:
            introduced.append({'line': number, 'length': width(line), 'sha256': digest(line.encode())})
    over = [key for key in LIMITS if metrics[key] > LIMITS[key]]
    gate_violations = [key for key in over if not historical or metrics[key] > historical[key]] if official else []
    frozen_growth = [key for key in metrics if historical and before and metrics[key] > before[key]]
    size_violations = [key for key in ['lines', 'bytes'] if metrics[key] > LIMITS[key]] if not official else []
    row = {'path': path, 'scope': 'official-root-subset' if official else 'supplemental-test-fixture-source',
           'sourceBlob': git('rev-parse', SOURCE + ':' + path).decode().strip(), 'sha256': digest(current),
           'before': before, 'after': metrics, 'historicalBaseline': historical,
           'delta': {key: metrics[key] - before[key] for key in metrics} if before else None,
           'officialGateViolations': gate_violations, 'frozenGrowthFromComparisonBase': frozen_growth,
           'supplementalSizeViolations': size_violations, 'introducedLongLines': introduced}
    rows.append(row)
    if gate_violations or frozen_growth or size_violations or introduced:
        violations.append(row)
python_path = 'tests/browser_editor_budgets_test.py'
python_paths = [path for path in source_paths if path.endswith('.py')]
if python_paths != [python_path]:
    raise RuntimeError('Changed Python scope differs from the one authorized file')
python_source = blob(SOURCE, python_path)
ast.parse(python_source.decode('utf-8'), filename=python_path)
finished = datetime.now(timezone.utc).isoformat()
report = {
    'schemaVersion': 1, 'kind': 'project16-a5-bounded-changed-source-inspection',
    'comparisonBase': BASE, 'sourceSha': SOURCE, 'sourceTree': TREE,
    'startedAt': started, 'finishedAt': finished, 'pythonVersion': platform.python_version(),
    'command': ['python', 'docs/evidence/project16-a5-changed-source/inspect.py'],
    'inspectionScriptSha256': digest(Path(__file__).read_bytes()), 'gitCommands': commands,
    'policyFiles': [{'path': path, 'sha256': digest(data)} for path, data in policies.items()],
    'limits': LIMITS, 'baselineUnchanged': baseline_unchanged,
    'method': {'lines': "UTF-8 source split on LF, including the trailing empty element, matching the official gate.",
               'bytes': 'Exact tracked Git blob byte length.',
               'lineLength': 'UTF-16 code units, matching JavaScript String.length in the official gate.',
               'introducedLines': 'Content-multiset comparison against the base; moved unchanged lines are not introduced.',
               'officialSubset': 'Only changed files matching the official roots, extensions and exclusions.',
               'supplement': 'Changed test/fixture/Python source outside that filter, explicitly checked for file size and introduced long lines.',
               'notChecked': 'Function length, parameter counts, nesting and semantic architecture are not inferred by this file-dimension inspection.'},
    'scopeCounts': {'changedTrackedPaths': len(paths), 'sourceFiles': len(rows),
                    'officialRootSubset': sum(row['scope'] == 'official-root-subset' for row in rows),
                    'supplementalTestFixtureSource': sum(row['scope'] != 'official-root-subset' for row in rows)},
    'files': rows, 'violations': violations,
    'pythonAst': {'path': python_path, 'sha256': digest(python_source), 'status': 'parsed',
                  'operation': 'ast.parse(decoded UTF-8 Git blob, filename=path); no imports or execution.'},
    'status': 'no_introduced_file_dimension_violations' if not violations and baseline_unchanged else 'findings',
    'limitsOfEvidence': ['Not a whole-repository structure gate.', 'No Node, tests, builds, benchmarks or browser execution.',
                         'No baseline changes; unrelated untracked files are outside the pinned Git scope.']
}
(OUTPUT / 'inspection.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'sourceSha': SOURCE, 'sourceTree': TREE,
                  'scopeCounts': report['scopeCounts'], 'pythonAst': report['pythonAst'],
                  'findings': [{'path': row['path'], 'gate': row['officialGateViolations'],
                                'frozenGrowth': row['frozenGrowthFromComparisonBase'],
                                'size': row['supplementalSizeViolations'], 'longLines': row['introducedLongLines']}
                               for row in violations]}, indent=2))
sys.exit(1 if violations or not baseline_unchanged else 0)
