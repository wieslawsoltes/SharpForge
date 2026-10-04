"""Journal the exact strict reference generation or six-row profiling-off command."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess, sys
revision='36a2af53287a563fd47d3a33b8e6e6382a726d35'
product=Path('/tmp/a05-qualification-'+revision)
reference=Path('/tmp/a05-profiler-reference-'+revision)
evidence=Path(__file__).resolve().parent
if len(sys.argv)!=2 or sys.argv[1] not in ('reference','off'):raise ValueError('Use reference or off')
action=sys.argv[1]
name='profiler-reference' if action=='reference' else 'profiler-off-100-attempt1'
report=evidence/(name+'.json');log=evidence/(name+'.log');journal_path=evidence/(name+'.journal.json')
assert not report.exists() and not log.exists() and not journal_path.exists()
def git(*args):return subprocess.check_output(['git',*args],cwd=product,text=True).strip()
def now():return datetime.now(timezone.utc).isoformat()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
assert git('rev-parse','HEAD')==revision and git('status','--porcelain=v1','--untracked-files=all')==''
command=['node','scripts/limited.js','node']
if action=='reference':
    command+=['bench/vm/profiler-reference.js','--dir',str(reference),'--out',str(report)]
else:
    command+=['--expose-gc','bench/vm/qualification.js','--runner','a05-linux-x64-node24','--suite','profiler',
              '--profiler-mode','off','--samples','100','--warmup','10','--native-bits','64','--seed','12012',
              '--resamples','10000','--timeout-seconds','1800','--profiler-reference',str(evidence/'profiler-reference.json'),
              '--out',str(report)]
resources={'SHARPFORGE_TEST_CONCURRENCY':'1','SHARPFORGE_MAX_PARALLEL_RUNS':'1','SHARPFORGE_MAX_OLD_SPACE_MB':'512'}
environment=dict(os.environ);environment.update(resources)
journal={'status':'running','action':action,'startedAt':now(),'revision':revision,'cwd':str(product),
         'command':command,'resourceEnvironment':resources,'inheritedNodeOptions':environment.get('NODE_OPTIONS'),
         'runnerScriptSha256':digest(Path(__file__)),'report':str(report),'log':str(log)}
with journal_path.open('x') as f:json.dump(journal,f,indent=2)
with log.open('x') as f:process=subprocess.run(command,cwd=product,env=environment,stdout=f,stderr=subprocess.STDOUT)
journal.update({'status':'finished','completedAt':now(),'exitCode':process.returncode,'endingRevision':git('rev-parse','HEAD'),
                'endingWorktreeStatus':git('status','--porcelain=v1','--untracked-files=all'),
                'reportSha256':digest(report) if report.exists() else None,'logSha256':digest(log)})
journal_path.write_text(json.dumps(journal,indent=2)+'\n')
print(json.dumps(journal))
sys.exit(process.returncode)
