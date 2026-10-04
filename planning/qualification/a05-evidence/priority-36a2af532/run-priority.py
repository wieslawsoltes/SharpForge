"""Record one unchanged priority measurement without masking a nonzero target result."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

revision = '36a2af53287a563fd47d3a33b8e6e6382a726d35'
tree = 'da3add4a11cce5ed887d2a093eac4b48a4c26754'
product = Path('/tmp/a05-qualification-' + revision)
evidence = Path(__file__).resolve().parent
target = sys.argv[1]
if len(sys.argv) != 2 or target not in ('source-fibonacci', 'virtual-cache'):
    raise ValueError('Exactly one prescribed priority target is required')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=product, text=True).strip()
def now():
    return datetime.now(timezone.utc).isoformat()
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
assert git('rev-parse', 'HEAD') == revision and git('rev-parse', 'HEAD^{tree}') == tree
assert git('status', '--porcelain=v1', '--untracked-files=all') == ''
report = evidence / (target + '-100-attempt1.json')
log = evidence / (target + '-100-attempt1.log')
journal_path = evidence / (target + '-100-attempt1.journal.json')
assert not report.exists() and not log.exists() and not journal_path.exists()
resources = {'SHARPFORGE_TEST_CONCURRENCY': '1', 'SHARPFORGE_MAX_PARALLEL_RUNS': '1',
             'SHARPFORGE_MAX_OLD_SPACE_MB': '512'}
command = ['node', 'scripts/limited.js', 'node', '--expose-gc', 'bench/vm/qualification.js',
           '--runner', 'a05-linux-x64-node24', '--suite', 'targets', '--target', target,
           '--samples', '100', '--warmup', '3', '--native-bits', '64', '--seed', '12012',
           '--resamples', '10000', '--timeout-seconds', '900', '--out', str(report)]
environment = dict(os.environ)
environment.update(resources)
journal = {'status': 'running', 'startedAt': now(), 'revision': revision, 'tree': tree,
           'cwd': str(product), 'command': command, 'resourceEnvironment': resources,
           'inheritedNodeOptions': environment.get('NODE_OPTIONS'), 'target': target,
           'runnerScriptSha256': digest(Path(__file__)), 'report': str(report), 'log': str(log)}
with journal_path.open('x') as output:
    json.dump(journal, output, indent=2)
with log.open('x') as output:
    process = subprocess.run(command, cwd=product, env=environment, stdout=output, stderr=subprocess.STDOUT)
journal.update({'status': 'finished', 'completedAt': now(), 'exitCode': process.returncode,
                'endingRevision': git('rev-parse', 'HEAD'),
                'endingWorktreeStatus': git('status', '--porcelain=v1', '--untracked-files=all'),
                'logSha256': digest(log), 'reportSha256': digest(report) if report.exists() else None})
journal_path.write_text(json.dumps(journal, indent=2) + '\n')
print(json.dumps(journal))
sys.exit(process.returncode)
