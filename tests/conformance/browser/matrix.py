"""Run one isolated qualification cell on an actual pinned Playwright browser."""
from contextlib import nullcontext
from pathlib import Path
import argparse
import importlib.metadata
import json
import os
import platform
import subprocess
import sys
import time
import tracemalloc

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_browser, results_dir
from conformance.browser.matrix_common import Checks, artifact_identity, load, serving, smoke
from conformance.browser import mobile_test, a11y_test, standalone_file_test


def revision():
    def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True,encoding='utf8').strip()
    return {'commit':git('rev-parse','HEAD'),'dirty':bool(git('status','--porcelain'))}

def apply_known(rows, *, engine, mode, suite, device, system):
    path=ROOT/'planning/qualification/browser/known-failures'/f'{engine}.json'
    spec=json.loads(path.read_text(encoding='utf8'))
    assert spec['engine']==engine and spec['schemaVersion']==1
    examined=[]
    for rule in spec['failures']:
        if any(rule[key]!=value for key,value in {'mode':mode,'suite':suite,'device':device,'platform':system}.items()):continue
        assert rule['reason'] and rule['issue'] and len(rule['errorContains'])>=12
        found=[r for r in rows if r['id']==rule['id']]
        assert len(found)==1, 'Known failure did not execute: '+rule['id']
        row=found[0]
        if row['status']=='failed' and rule['errorContains'] in row['error']:
            row['status']='known-failure';row['knownFailure']=rule
        elif row['status']=='passed':
            row['status']='unexpected-pass';row['error']='Remove resolved known-failure entry: '+rule['id']
        examined.append(rule['id'])
    return examined

def run(args):
    from playwright.sync_api import sync_playwright
    start_revision=revision();started=time.perf_counter();tracemalloc.start()
    directory=results_dir()/('matrix-'+args.engine+'-'+args.mode+'-'+args.suite+'-'+(args.device or 'desktop').replace(' ','_'))
    directory.mkdir(parents=True,exist_ok=True)
    report={'schemaVersion':1,'engine':args.engine,'mode':args.mode,'suite':args.suite,'device':args.device,
            'category':'deployed' if args.mode=='deployed' else 'harness' if args.mode=='in-memory' else 'served',
            'platform':platform.system().lower(),'platformVersion':platform.platform(),'architecture':platform.machine(),'python':platform.python_version(),
            'node':subprocess.check_output([os.getenv('NODE','node'),'--version'],text=True).strip(),
            'playwright':importlib.metadata.version('playwright'),'source':start_revision,'artifactSha256':artifact_identity(),
            'command':[sys.executable,*sys.argv],'emulated':bool(args.device),'hardwareQualified':False,'browserVersion':'unavailable','checks':[]}
    checks=None
    try:
        with serving(args.mode) if args.mode in ('http','https','isolated') else nullcontext(args.url) as url:
            with sync_playwright() as p, launch_browser(p,directory.name,engine=args.engine) as browser:
                report['browserVersion']=browser.version
                options={'viewport':{'width':1440,'height':1000},'ignore_https_errors':args.mode in ('https','isolated')}
                if args.device:
                    options.update(p.devices[args.device])
                    options.pop('default_browser_type',None)
                    if args.engine=='firefox':options.pop('is_mobile',None)
                page=browser.new_page(**options);page.set_default_timeout(12000)
                page.on('dialog',lambda d:d.accept())
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                checks=Checks(page,directory);report['checks']=checks.rows
                if args.mode=='file':
                    standalone_file_test.qualify(checks,iterations=args.iterations)
                else:
                    if args.mode=='in-memory':
                        from browser_harness import load_application
                        os.environ['SHARPFORGE_IN_MEMORY']='1'
                        checks.check('harness-navigation',lambda:load_application(page) and {'scope':'In-memory Blob module loader and storage replacement'})
                    else:
                        report['navigation']={}
                        row=checks.check('navigation-policy',lambda:load(page,url,mode=args.mode,observation=report['navigation']))
                        if args.mode=='deployed':
                            report['deployment']={'url':url,'applicationRevision':'unknown','harnessRevision':start_revision['commit'],'reason':'Current published application does not expose a verified build revision; checkout revision identifies only the qualification harness.'}
                        report['coldNavigationToCompilerReadyMs']=row['milliseconds']
                    if args.suite=='mobile':mobile_test.qualify(checks,device=args.device,engine=args.engine)
                    elif args.suite=='a11y':a11y_test.qualify(checks,engine=args.engine)
                    else:smoke(checks,mode=args.mode,iterations=args.iterations)
                checks.check('no-browser-errors',lambda: (_ for _ in ()).throw(AssertionError(repr(errors))) if errors else {'errors':[]})
                checks.check('csp-clean',browser.csp.assert_clean)
                report['cspViolations']=browser.csp.events
                if any(r['status']=='failed' for r in checks.rows):
                    raise AssertionError('Qualification cell contains failed checks; retaining browser diagnostics')
    except KeyboardInterrupt as error:
        report['checks'].append({'id':'session','status':'cancelled','error':str(error)})
    except Exception as error:
        if not any(r['status']=='failed' for r in report['checks']):
            report['checks'].append({'id':'session','status':'failed','error':str(error),'errorType':type(error).__name__})
    finally:
        if args.mode=='in-memory':os.environ.pop('SHARPFORGE_IN_MEMORY',None)
        current,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
        report['pythonAllocationBytes']={'current':current,'peak':peak,'excludes':'Browser/worker native and JS heaps'}
        report['seconds']=time.perf_counter()-started
        report['endSource']=revision()
        if report['endSource']!=start_revision:
            report['checks'].append({'id':'source-stability','status':'failed','error':'Source revision or dirty state changed during qualification'})
        report['qualification']='development' if start_revision['dirty'] else 'committed'
        try:report['knownFailuresExamined']=apply_known(report['checks'],engine=args.engine,mode=args.mode,suite=args.suite,device=args.device,system=report['platform'])
        except Exception as error:report['checks'].append({'id':'known-failures-policy','status':'failed','error':str(error)})
        report['passed']=bool(report['checks']) and all(r['status'] in ('passed','unsupported') for r in report['checks'])
        report['parityPassed']=bool(report['checks']) and all(r['status']=='passed' for r in report['checks'])
        (directory/'result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
        print(json.dumps({'result':str(directory/'result.json'),'passed':report['passed'],'parityPassed':report['parityPassed']},indent=2),flush=True)
    return 0 if report['passed'] else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine',choices=('chromium','firefox','webkit'),required=True)
    parser.add_argument('--mode',choices=('http','https','isolated','file','in-memory','deployed'),default='http')
    parser.add_argument('--suite',choices=('smoke','mobile','a11y'),default='smoke')
    parser.add_argument('--device',choices=mobile_test.DEVICES)
    parser.add_argument('--url')
    parser.add_argument('--iterations',type=int,default=3)
    args=parser.parse_args()
    if not 3<=args.iterations<=100:parser.error('iterations must be between 3 and 100')
    if (args.suite=='mobile')!=bool(args.device):parser.error('mobile suite requires exactly one device descriptor')
    if args.mode=='file' and args.suite!='smoke':parser.error('file mode currently qualifies the compile/run/debug smoke suite')
    if args.mode=='deployed':
        from urllib.parse import urlsplit
        url=urlsplit(args.url or '')
        if url.scheme!='https' or not url.netloc or url.username or url.password:parser.error('deployed mode requires a public HTTPS URL without credentials')
    elif args.url:parser.error('--url is only supported for deployed mode')
    sys.exit(run(args))
