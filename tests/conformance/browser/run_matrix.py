"""Bounded sequential matrix cells; retain all results even when one mode fails."""
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.run_suite import cancel
from conformance.browser.launch import results_dir

def bounded(command,timeout,directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    cancel_file=directory/'cancel.request'
    cancel_file.unlink(missing_ok=True)
    started=time.perf_counter()
    with (directory/'process.log').open('w',encoding='utf8') as log:
        process=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'SHARPFORGE_CANCEL_FILE':str(cancel_file)},creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name=='nt' else 0)
        timed_out=False
        try:code=process.wait(timeout=timeout)
        except (subprocess.TimeoutExpired,KeyboardInterrupt):
            timed_out=True;cancel(process,cancel_file)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            code=124
    value={'command':command,'exitCode':code,'timedOut':timed_out,'seconds':time.perf_counter()-started}
    (directory/'process.json').write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
    return value

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--engine',required=True,choices=('chromium','firefox','webkit'));parser.add_argument('--suite',default='smoke',choices=('smoke','mobile','a11y','harness'));parser.add_argument('--timeout',type=int,default=180)
    args=parser.parse_args()
    if not 1<=args.timeout<=1200:parser.error('timeout must be between 1 and 1200 seconds')
    cells=[('http','mobile',d) for d in ('iPhone 13','Pixel 5','iPad (gen 7)')] if args.suite=='mobile' else [('in-memory','smoke',None)] if args.suite=='harness' else [('http','a11y',None)] if args.suite=='a11y' else [(mode,'smoke',None) for mode in ('http','https','isolated','file')]
    rows=[]
    for mode,suite,device in cells:
        command=[sys.executable,'tests/conformance/browser/matrix.py','--engine',args.engine,'--mode',mode,'--suite',suite]
        if device:command+=['--device',device]
        directory=results_dir()/('process-'+args.engine+'-'+mode+'-'+suite+'-'+str(device).replace(' ','_'))
        row=bounded(command,args.timeout,directory);rows.append(row)
        print(mode,suite,device,row['exitCode'],flush=True)
    (results_dir()/('matrix-processes-'+args.engine+'-'+args.suite+'.json')).write_text(json.dumps(rows,indent=2)+'\n',encoding='utf8')
    sys.exit(0 if all(row['exitCode']==0 for row in rows) else 1)
