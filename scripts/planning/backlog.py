#!/usr/bin/env python3
"""Generate and validate the audited backlog; no network or repository mutations."""
import argparse, csv, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
REPO='wieslawsoltes/SharpForge'
BASE='011f2bc3bdd84f8db82a928d117100017211ca78'
PLAN_BASE='7f0ca223d1b9a07725078260020019cfb276c241'
# New files are proposed ownership boundaries, not claims that modules already exist.
GATES={
'A01':['A00-T05'],'A02':['A00-T01','A00-T05'],'A03':['A00-T05'],
'A04':['A00-T01','A03-T01','A03-T02'],'A05':['A00-T01','A00-T04'],
'A06':['A00-T04'],'A07':['A00-T02'],'A08':['A00-T02','A02-T02'],
'A09':['A00-T02'],'A10':['A00-T01'],'A11':['A00-T04'],
'A12':['A00-T04'],'A13':['A03-T01'],'A14':['A00-T04','A00-T05'],
'A15':['A00-T02'],'A16':['A00-T03'],'A17':['A00-T03'],
'A18':['A00-T03','A00-T05'],'A19':['A00-T03'],'A20':['A00-T05'],
'A21':['A00-T05'],'A22':['A00-T02','A00-T05'],'A23':['A00-T03'],
'A24':['A00-T03'],'A25':['A00-T03'],'A26':['A00-T03','A00-T04'],
'A27':['A00-T01','A00-T04','A00-T05'],'A28':['A00-T01','A00-T04'],'A29':[]}
# Additional concrete cross-area gates; no circular implementation ownership.
EXTRA={'A02-T02':['A01-T05'],'A02-T08':['A01-T06'],
'A02-T11':['A01-T08','A01-T09','A01-T10'],
'A05-T02':['A04-T03'],'A11-T08':['A11-T07','A06-T04'],
'A14-T10':['A23-T03'],'A15-T05':['A21-T01'],
'A16-T03':['A16-T01'],'A18-T01':['A19-T01'],
'A18-T10':['A19-T01','A14-T10'],'A19-T02':['A19-T01'],
'A22-T02':['A04-T02'],'A26-T04':['A26-T03'],
'A26-T06':['A27-T08'],'A27-T06':['A28-T02'],
'A27-T10':['A11-T07','A28-T10'],'A28-T09':['A28-T05','A28-T10']}
# Foundation tasks can be taken now. Read-only inventories/design tasks need no code seams.
READY={'A00-T01','A00-T07','A00-T11','A01-T01','A03-T01','A13-T01',
       'A17-T01','A22-T01','A25-T01','A26-T01','A27-T01','A28-T01',
       'A29-T01','A29-T02','A29-T03','A29-T11'}
def sid(x):return 'SF-'+x

def load():
    areas=[]; area=None
    for no,line in enumerate((ROOT/'planning/catalog.txt').read_text().splitlines(),1):
        if not line.strip():continue
        p=line.split('|')
        if line.startswith('@'):
            if len(p)!=5:raise ValueError(f'line {no}: invalid area')
            area={'id':p[0][1:],'name':p[1],'evidence':p[2].split(';'),
                  'write_paths':p[3].split(';'),'epic_titles':p[4].split(';'),'tasks':[]}
            areas.append(area)
        else:
            if area is None or len(p)!=3:raise ValueError(f'line {no}: invalid task')
            area['tasks'].append({'title':p[0],'deliverable':p[1],'acceptance':p[2]})
    assert len(areas)==30
    items=[]
    for area in areas:
        aid=area['id']; assert len(area['tasks'])==12,aid
        for n,title in enumerate(area['epic_titles'],1):
            items.append({'id':sid(f'{aid}-E{n:02}'),'kind':'epic','area':aid,
              'title':title,'parent':'SF-PORTFOLIO','priority':'P1','phase':'P1 Foundations',
              'dependencies':[],'locks':['area:'+aid],'write_paths':area['write_paths'],
              'evidence':area['evidence'],'children':[sid(f'{aid}-T{i:02}') for i in range((n-1)*6+1,n*6+1)]})
        for i,t in enumerate(area['tasks'],1):
            key=f'{aid}-T{i:02}'; deps=list(GATES.get(aid,[]))
            if aid=='A00':deps=[] if i in [1,7,11] else ['A00-T01']
            if i>=7 and aid!='A00':deps.append(f'{aid}-T01')
            deps+=EXTRA.get(key,[])
            if key in READY:deps=[]
            t.update(id=sid(key),kind='task',area=aid,parent=sid(f'{aid}-E{1 if i<=6 else 2:02}'),
                     priority='P0' if key in READY and aid in ['A00','A29'] else ('P1' if i<=6 else 'P2'),
                     phase='P0 Unblock' if key in READY else ('P1 Foundations' if i<=6 else 'P2 Expansion'),
                     dependencies=[sid(d) for d in sorted(set(deps)) if d!=key],
                     locks=['area:'+aid],write_paths=area['write_paths'],evidence=area['evidence'],
                     test_path=f'tests/{aid.lower()}-{i:02}-*.test.js',
                     agent=None,lease_until=None,branch=None,estimate='Split during claim if more than 3 focused PRs')
            items.append(t)
    by={x['id']:x for x in items}; assert len(by)==420
    def visit(k,active,done):
        if k in active:raise ValueError('Dependency cycle: '+k)
        if k in done:return
        active.add(k)
        for d in by[k]['dependencies']:
            if d not in by:raise ValueError('Unknown dependency '+d)
            visit(d,active,done)
        active.remove(k);done.add(k)
    done=set()
    for k in by:visit(k,set(),done)
    return {'schema':1,'repository':REPO,'source_commit':BASE,'planning_base':PLAN_BASE,
            'as_of':'2026-10-03','areas':areas,'items':items,'portfolio':'SF-PORTFOLIO'}

def issue_body(item,manifest,links=None):
    links=links or {}; area=next(a for a in manifest['areas'] if a['id']==item['area'])
    def link(key):return links.get(key,{}).get('url',f'https://github.com/{REPO}/issues?q='+key)
    out=[f"<!-- sharpforge-backlog:{item['id']} -->",f"# {item['title']}",
         f"**Area:** {item['area']} — {area['name']}  ",
         f"**Parent:** [{item['parent']}]({link(item['parent'])})  ",
         f"**Priority / phase:** {item['priority']} / {item['phase']}",
         '## Audited starting point',
         f"Product source: `{BASE}`; later CI-only fix `{PLAN_BASE}` is preserved, not treated as product parity."]
    out += [f'- [{p}](https://github.com/{REPO}/blob/{BASE}/{p})' for p in item['evidence']]
    if item['kind']=='epic':
        out += ['## Child work',*[f'- [{k}]({link(k)}): '+next(x['title'] for x in manifest['items'] if x['id']==k) for k in item['children']],
                'Close only after every child has merged evidence. The project board must not count an epic and its children as independent delivered capabilities.']
    else:
        out += ['## Deliverable',item['deliverable'],'## Acceptance criteria',
                '- [ ] '+item['acceptance'],
                '- [ ] Add positive, malformed/negative, cancellation/disposal and boundary tests where applicable.',
                '- [ ] Verify every affected execution/platform target independently; explicitly record unsupported targets.',
                '- [ ] Add or update a runnable example, API capability row and regression test.',
                '- [ ] Measure cold/warm latency, p95/p99 and allocations for performance-sensitive paths; keep correctness gates.',
                '- [ ] Record exact commits, tool versions and commands; no fixture simulator is reported as native qualification.',
                '## Atomic implementation checklist',
                '- [ ] Pin the applicable specification/API signatures and reproduce the current gap.',
                '- [ ] Implement the smallest owned module change; do not mix unrelated cleanup.',
                '- [ ] Add public contract/adapter integration through the shared-file owner.',
                '- [ ] Add edge-case and cross-engine/reference fixtures.',
                '- [ ] Update examples and compatibility inventory, then submit a focused PR.',
                '- [ ] Validate rebased integration and attach the evidence before closing.',
                f"**Proposed new test prefix:** `{item['test_path']}` (existing runner discovers top-level `.test.js`)."]
    out+=['## Dependencies',*( [f'- [{d}]({link(d)})' for d in item['dependencies']] or ['No implementation prerequisite. Claim still requires an ownership lease.']),
          '## Ownership and parallel-agent rules',
          '**Write only:** '+', '.join('`'+p+'`' for p in item['write_paths']),
          '**Read-only evidence is not permission to edit shared files.** New paths above are proposed extraction destinations.',
          '**Exclusive lease:** '+', '.join('`'+p+'`' for p in item['locks']),
          'Registry IDs, shared runtime dispatchers, root build/test registration and `studio.js` require A00 integration review. '+
          'Narrow the file lock at claim time before running a second agent in this area. Never edit another area to bypass a dependency.',
          '## Agent handoff',
          'Agent: unassigned. Branch: not created. Lease/heartbeat: not claimed. '+
          'Record task ID, branch, last verified commit, commands, artifacts, blockers and next step in each handoff. '+
          'Ready means prerequisite contracts have merged and been qualified, not merely that another agent started them.',
          '## Scope boundary',
          'This task owns only the deliverable above. Existing behavior is extended/qualified rather than reimplemented blindly. '+
          'Full parity is measured against a versioned inventory; browser platform restrictions must be explicit, not hidden behind a success label.']
    return '\n\n'.join(out)+'\n'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',default='planning/generated');a=ap.parse_args()
    m=load();out=ROOT/a.output;out.mkdir(parents=True,exist_ok=True)
    (out/'backlog.json').write_text(json.dumps(m,indent=2)+'\n')
    with (out/'tasks.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['id','area','kind','title','parent','priority','phase','dependencies','locks','deliverable','acceptance'])
        for t in m['items']:w.writerow([t.get(k,'') if k not in ['dependencies','locks'] else ';'.join(t[k]) for k in ['id','area','kind','title','parent','priority','phase','dependencies','locks','deliverable','acceptance']])
    lines=['# SharpForge backlog','',f"Pinned product source: `{BASE}`. 30 areas, 60 epics, 360 leaf tasks. Native project boards require the separate authorized provisioning command."]
    for a in m['areas']:
        lines+=['',f"## {a['id']} — {a['name']}",'', 'Write scope: '+', '.join('`'+x+'`' for x in a['write_paths'])]
        for t in [x for x in m['items'] if x['area']==a['id']]:
            lines+=['',f"### {t['id']} — {t['title']}",issue_body(t,m)]
    (out/'BACKLOG.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'areas':len(m['areas']),'epics':60,'tasks':360,'dependency_edges':sum(len(x['dependencies']) for x in m['items']),'initial_ready':sum(not x['dependencies'] for x in m['items'] if x['kind']=='task')}))
if __name__=='__main__':main()
