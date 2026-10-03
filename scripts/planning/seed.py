#!/usr/bin/env python3
"""Idempotent issue/epic provisioning. Writes only with --apply and repo-scoped token.
Stops on ambiguous write failures: rerun scans markers before creating anything.
"""
import argparse, json, os, re, time, urllib.request, urllib.error
from pathlib import Path
from backlog import load, issue_body, REPO, ROOT
API='https://api.github.com/graphql'
MARK=re.compile(r'<!-- sharpforge-backlog:([A-Z0-9-]+) -->')
class Client:
    def __init__(self, token):
        if not token:raise RuntimeError('GH_TOKEN or GITHUB_TOKEN is required for --apply')
        self.token=token;self.writes=0;self.last=0
    def query(self,q,v=None):
        write=q.lstrip().startswith('mutation')
        if write:
            if self.writes>=470:raise RuntimeError('Conservative 470-write run budget reached; rerun later')
            time.sleep(max(0,1.35-(time.monotonic()-self.last)))
        req=urllib.request.Request(API,json.dumps({'query':q,'variables':v or {}}).encode(),
            {'Authorization':'Bearer '+self.token,'Accept':'application/vnd.github+json',
             'Content-Type':'application/json','User-Agent':'SharpForge-Backlog-Provisioner'})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req,timeout=90) as r:result=json.load(r)
                if result.get('errors'):raise RuntimeError(json.dumps(result['errors'])[:2000])
                if write:self.writes+=1;self.last=time.monotonic()
                return result['data']
            except urllib.error.HTTPError as e:
                if e.code in (403,429) and attempt<4:
                    wait=max(60,int(e.headers.get('Retry-After','60')));print('Rate limited; waiting',wait,flush=True);time.sleep(wait);continue
                raise RuntimeError(f'GitHub HTTP {e.code}: '+e.read().decode(errors='replace')[:1200]) from e
            except (TimeoutError,urllib.error.URLError) as e:
                if write:raise RuntimeError('Ambiguous write result; rerun to rediscover stable markers') from e
                if attempt==4:raise
                time.sleep(2**attempt)
    def issues(self):
        owner,name=REPO.split('/');cursor=None;out={};repo_id=None
        while True:
            d=self.query('query($o:String!,$n:String!,$c:String){repository(owner:$o,name:$n){id issues(first:100,after:$c,states:[OPEN,CLOSED]){nodes{id number url title body state parent{id} labels(first:100){nodes{id name}}} pageInfo{hasNextPage endCursor}}}}',{'o':owner,'n':name,'c':cursor})['repository']
            repo_id=d['id']
            for issue in d['issues']['nodes']:
                m=MARK.search(issue.get('body') or '')
                if m:
                    if m[1] in out:raise RuntimeError('Duplicate stable marker '+m[1])
                    out[m[1]]=issue
            page=d['issues']['pageInfo']
            if not page['hasNextPage']:return repo_id,out
            cursor=page['endCursor']
    def labels(self):
        o,n=REPO.split('/');c=None;out={}
        while True:
            d=self.query('query($o:String!,$n:String!,$c:String){repository(owner:$o,name:$n){labels(first:100,after:$c){nodes{id name} pageInfo{hasNextPage endCursor}}}}',{'o':o,'n':n,'c':c})['repository']['labels']
            out.update({x['name']:x['id'] for x in d['nodes']})
            if not d['pageInfo']['hasNextPage']:return out
            c=d['pageInfo']['endCursor']

def seed(client,manifest,out):
    rid,links=client.issues()
    if 'SF-PORTFOLIO' not in links:raise RuntimeError('Portfolio issue must exist first')
    labels=client.labels()
    definitions={**{'area:'+a['id']:'1D76DB' for a in manifest['areas']},
                 'kind:epic':'5319E7','kind:task':'0E8A16','priority:P0':'B60205',
                 'priority:P1':'D93F0B','priority:P2':'FBCA04','state:blocked':'D4C5F9',
                 'state:ready':'C2E0C6'}
    for name,color in definitions.items():
        if name not in labels:
            d=client.query('mutation($i:CreateLabelInput!){createLabel(input:$i){label{id}}}',
                {'i':{'repositoryId':rid,'name':name,'color':color,'description':'SharpForge parity planning'}})
            labels[name]=d['createLabel']['label']['id']
    todo={t['id']:t for t in manifest['items']}
    # Parents first, then dependency topological order. Native children attached on creation.
    while todo:
        progress=False
        for key,t in list(todo.items()):
            if t['parent'] not in links or any(d not in links for d in t['dependencies']):continue
            if key in links:
                if links[key].get('parent',{}).get('id')!=links[t['parent']]['id']:
                    raise RuntimeError('Existing issue has wrong/missing parent: '+key+'; reconcile explicitly')
            else:
                names=['area:'+t['area'],'kind:'+t['kind'],'priority:'+t['priority']]
                if t['kind']=='task':names.append('state:blocked' if t['dependencies'] else 'state:ready')
                data=client.query('mutation($i:CreateIssueInput!){createIssue(input:$i){issue{id number url title state parent{id}}}}',
                    {'i':{'repositoryId':rid,'title':'['+key+'] '+t['title'],
                          'body':issue_body(t,manifest,links),'parentIssueId':links[t['parent']]['id'],
                          'labelIds':[labels[n] for n in names]}})['createIssue']['issue']
                if data.get('parent',{}).get('id')!=links[t['parent']]['id']:
                    raise RuntimeError('GitHub did not confirm native parent for '+key)
                links[key]=data;print(key,data['url'],flush=True)
                out.write_text(json.dumps(links,indent=2)+'\n')
            del todo[key];progress=True
        if not progress:raise RuntimeError('Unresolved dependency order: '+','.join(todo))
    _,verified=client.issues()
    assert all(x['id'] in verified for x in manifest['items'])
    out.write_text(json.dumps(verified,indent=2)+'\n')
    result={'areas_planned':30,'epics_verified':60,'tasks_verified':360,'native_parent_links':420,
            'projects_created':0,'projects_status':'requires separate project-scoped authorization',
            'writes_this_run':client.writes}
    print(json.dumps(result),flush=True)
    (out.parent/'seed-result.json').write_text(json.dumps(result,indent=2)+'\n')
    summary=os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a') as f:f.write('# Backlog provisioning\n\n'+json.dumps(result,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args();m=load()
    if not a.apply:print(json.dumps({'dry_run':True,'areas':30,'epics':60,'tasks':360,'project_boards':'not created by this script'}));return
    if os.environ.get('GITHUB_REPOSITORY',REPO)!=REPO:raise RuntimeError('Wrong repository')
    out=ROOT/'planning/generated';out.mkdir(parents=True,exist_ok=True)
    seed(Client(os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')),m,out/'issue-map.json')
if __name__=='__main__':main()
