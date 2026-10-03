"""Small correctness-gated cold/warm browser probe; not a performance pass threshold."""
from pathlib import Path
import argparse
import importlib.metadata
import json
import math
import platform
import subprocess
import sys
import time
import tracemalloc
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tests'))
from conformance.browser.launch import launch_browser,results_dir
from conformance.browser.matrix_common import serving,load,compile_run

def distribution(values):
    ordered=sorted(values)
    return {'samplesMs':values,'p95Ms':ordered[math.ceil(len(values)*.95)-1],'p99Ms':ordered[math.ceil(len(values)*.99)-1]}

def main(engine,cold_count,warm_count):
    from playwright.sync_api import sync_playwright
    cold,warm=[],[];tracemalloc.start();version=None
    with serving('http') as url, sync_playwright() as p:
        for index in range(cold_count):
            start=time.perf_counter()
            with launch_browser(p,'matrix-latency-'+engine+'-'+str(index),engine=engine) as browser:
                version=browser.version;page=browser.new_page()
                load(page,url,mode='http');compile_run(page)
                cold.append((time.perf_counter()-start)*1000)
                for _ in range(warm_count):
                    start=time.perf_counter();compile_run(page);warm.append((time.perf_counter()-start)*1000)
    current,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
    report={'schemaVersion':1,'engine':engine,'browserVersion':version,'platform':platform.platform(),'playwright':importlib.metadata.version('playwright'),
            'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'command':[sys.executable,*sys.argv],
            'coldLaunchNavigationCompileRun':distribution(cold),'warmCompileRun':distribution(warm),
            'pythonAllocationBytes':{'current':current,'peak':peak},'browserAllocations':{'status':'unavailable','reason':'No cross-engine browser allocation counter'},
            'scope':'Actual isolated browser processes with native storage and workers. OS disk cache not flushed. Python allocations exclude browser processes. Small sample quantiles are diagnostic, not a regression gate.'}
    (results_dir()/('latency-'+engine+'.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--engine',required=True,choices=('chromium','firefox','webkit'));parser.add_argument('--cold',type=int,default=3);parser.add_argument('--warm',type=int,default=10)
    args=parser.parse_args()
    if not 3<=args.cold<=100 or not 3<=args.warm<=100:parser.error('sample counts must be between 3 and 100')
    main(args.engine,args.cold,args.warm)
