import datetime
import json
from pathlib import Path
import subprocess

EXPECTED_COMMIT = 'd64188af91f03d02041316bdde2ee64fd0634be0'
EXPECTED_TREE = 'd683a1cee6e29cddb2735734878f70c1ea382a05'
REQUIRED_MS = 600000
root = Path.cwd()
git = lambda *args: subprocess.check_output(['git', *args], text=True).strip()
assert git('rev-parse', 'HEAD') == EXPECTED_COMMIT
assert git('rev-parse', 'HEAD^{tree}') == EXPECTED_TREE
assert not git('status', '--porcelain')
aggregate_path = root / 'artifacts/fuzz/project4-pe-postfix-duration.json'
assert not aggregate_path.exists(), 'Refuse to replace an earlier qualification record'
campaigns = []
duration_ms = 0
counts = dict(accepted=0, rejected=0, unsupported=0, findings=0, cancelled=0)
status = 'incomplete'

for sequence in range(1, 9):
    output = f'artifacts/fuzz/project4-pe-postfix-seed{sequence}'
    assert not (root / output).exists(), 'Refuse to replace an earlier campaign'
    argv = ['node', 'scripts/conformance/fuzz/run.js', '--target', 'pe-loader',
            '--seed', str(sequence), '--cases', '512', '--case-ms', '1000',
            '--campaign-ms', '600000', '--output', output]
    result = subprocess.run(argv, cwd=root, check=False)
    summary_path = root / output / 'summary.json'
    if not summary_path.is_file():
        campaigns.append(dict(sequence=sequence, argv=argv, exitCode=result.returncode,
                              output=output, status='missing-report'))
        status = 'failed'
        break
    summary = json.loads(summary_path.read_text())
    started = datetime.datetime.fromisoformat(summary['started'].replace('Z', '+00:00'))
    finished = datetime.datetime.fromisoformat(summary['finished'].replace('Z', '+00:00'))
    elapsed = round((finished - started).total_seconds() * 1000)
    target = summary['targets'][0]
    campaign = dict(sequence=sequence, argv=argv, exitCode=result.returncode,
                    output=output, started=summary['started'], finished=summary['finished'],
                    durationMs=elapsed, status=summary['status'], counts=target['counts'],
                    requestedCases=target['requestedCases'], completedCases=target['completedCases'],
                    sourceBefore=summary['sourceBefore'], sourceAfter=summary['sourceAfter'])
    campaigns.append(campaign)
    for name in counts:
        counts[name] += target['counts'][name]
    duration_ms += elapsed
    print(json.dumps(dict(completedCampaign=sequence, durationMs=duration_ms,
                          status=summary['status'], counts=counts)), flush=True)
    same_source = all(summary[key] == dict(commit=EXPECTED_COMMIT, tree=EXPECTED_TREE, clean=True)
                      for key in ['sourceBefore', 'sourceAfter'])
    if result.returncode != 0 or summary['status'] != 'passed' or not same_source:
        status = 'failed'
        break
    if duration_ms >= REQUIRED_MS:
        status = 'passed'
        break

record = dict(schemaVersion=1, kind='sharpforge-pe-postfix-duration-qualification', status=status,
              qualified=status == 'passed', scope='bounded-node-linux-x64-pe-loader',
              requiredDurationMs=REQUIRED_MS, recordedCampaignDurationMs=duration_ms,
              sourceIdentity=dict(commit=EXPECTED_COMMIT, tree=EXPECTED_TREE, clean=True),
              counts=counts, campaigns=campaigns,
              limitations=['Duration sums completed CLI campaign windows and excludes gaps between campaigns.',
                           'Recorded accepted and controlled-rejected inputs do not prove universal parser safety.',
                           'No other engine/platform or operating-system sandbox qualification is implied.'])
aggregate_path.parent.mkdir(parents=True, exist_ok=True)
with aggregate_path.open('x') as stream:
    json.dump(record, stream, indent=2)
    stream.write('\n')
print(json.dumps(dict(qualification=status, durationMs=duration_ms, counts=counts)), flush=True)
raise SystemExit(0 if status == 'passed' else 1)
