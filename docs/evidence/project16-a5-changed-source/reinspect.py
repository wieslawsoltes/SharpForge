"""Reinspect the original changed-source set after the narrow compiler formatting correction."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys


BASE = 'c13aa0fd9d27df28b3708bb83d914a04c20a5c7c'
SOURCE = 'a5977d0e0713997766e2d16101f44bc2a776a114'
TREE = 'cf7a61b6964b794d1b0128cbaffafd180b643ef0'
OUTPUT = Path(__file__).resolve().parent
ROOT = OUTPUT.parents[2]
initial = json.loads((OUTPUT / 'inspection.json').read_text())
commands = []


def git(*args):
    command = ['git', *args]
    commands.append(command)
    return subprocess.check_output(command, cwd=ROOT)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def width(text):
    return len(text.encode('utf-16-le')) // 2


def measure(data):
    lines = data.decode('utf-8').split('\n')
    return {'lines': len(lines), 'bytes': len(data), 'lineLength': max(map(width, lines), default=0)}


started = datetime.now(timezone.utc).isoformat()
if git('rev-parse', SOURCE + '^{tree}').decode().strip() != TREE:
    raise RuntimeError('Unexpected correction tree')
changed = git('diff', '--name-only', '--diff-filter=AM', '-z', BASE, SOURCE).decode().split('\0')[:-1]
source_paths = [path for path in changed if Path(path).suffix in {'.js', '.mjs', '.rs', '.css', '.py'}]
if source_paths != [row['path'] for row in initial['files']]:
    raise RuntimeError('The changed-source set differs from the original 37-file inspection')
rows = []
findings = []
for original in initial['files']:
    path = original['path']
    current = git('show', SOURCE + ':' + path)
    previous = git('show', BASE + ':' + path) if original['before'] is not None else b''
    metrics = measure(current)
    prior_lines = Counter(previous.decode('utf-8').split('\n'))
    introduced = []
    for number, line in enumerate(current.decode('utf-8').split('\n'), 1):
        if prior_lines[line]:
            prior_lines[line] -= 1
        elif width(line) > 160:
            introduced.append({'line': number, 'length': width(line), 'sha256': digest(line.encode())})
    official = original['scope'] == 'official-root-subset'
    baseline = original['historicalBaseline']
    over = [key for key, limit in initial['limits'].items() if metrics[key] > limit]
    gate = [key for key in over if not baseline or metrics[key] > baseline[key]] if official else []
    growth = bool(baseline and metrics['bytes'] > original['before']['bytes'])
    supplemental = [key for key in ['lines', 'bytes'] if metrics[key] > initial['limits'][key]] if not official else []
    row = {'path': path, 'scope': original['scope'], 'sha256': digest(current), 'before': original['before'],
           'afterInitial': original['after'], 'after': metrics, 'historicalBaseline': baseline,
           'unchangedSinceInitial': digest(current) == original['sha256'],
           'officialGateViolations': gate, 'frozenByteGrowthFromComparisonBase': growth,
           'supplementalSizeViolations': supplemental, 'introducedLongLines': introduced}
    rows.append(row)
    if gate or growth or supplemental or introduced:
        findings.append(row)
policies = []
for policy in initial['policyFiles']:
    data = git('show', SOURCE + ':' + policy['path'])
    if digest(data) != policy['sha256']:
        raise RuntimeError('Inspection policy changed since the original source')
    policies.append(policy)
finished = datetime.now(timezone.utc).isoformat()
report = {'schemaVersion': 1, 'kind': 'project16-a5-bounded-changed-source-reinspection',
          'comparisonBase': BASE, 'sourceSha': SOURCE, 'sourceTree': TREE,
          'startedAt': started, 'finishedAt': finished,
          'command': ['python', 'docs/evidence/project16-a5-changed-source/reinspect.py'],
          'inspectionScriptSha256': digest(Path(__file__).read_bytes()), 'gitCommands': commands,
          'initialEvidenceSha256': digest((OUTPUT / 'inspection.json').read_bytes()),
          'policyFiles': policies, 'limits': initial['limits'], 'scopeCounts': initial['scopeCounts'],
          'changedTrackedPathsAtReinspection': len(changed), 'files': rows, 'violations': findings,
          'status': 'no_introduced_file_dimension_violations' if not findings else 'findings',
          'method': 'Repeat exact Git-blob file measurements and content-multiset added-line comparison for the original 37 sources.',
          'freezeInterpretation': 'Official gate rules are unchanged; additionally require no frozen byte growth versus c13. '
                                  'Readable line reflow is reported, not rejected when below the official line limit.',
          'pythonAst': {'executed': False, 'retainedSourceSha': initial['sourceSha'],
                        'evidence': 'inspection.json', 'fileUnchanged': next(
                            row['unchangedSinceInitial'] for row in rows if row['path'].endswith('.py'))},
          'limitsOfEvidence': initial['limitsOfEvidence'] + [
              'No new Python AST parse, JavaScript syntax/runtime execution, or function/nesting analysis.']}
(OUTPUT / 'reinspection.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'sourceSha': SOURCE, 'sourceTree': TREE,
                  'sourceFiles': len(rows), 'changedSinceInitial': [row for row in rows if not row['unchangedSinceInitial']],
                  'findings': findings, 'pythonAst': report['pythonAst']}, indent=2))
sys.exit(1 if findings else 0)
