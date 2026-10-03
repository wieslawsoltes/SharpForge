#!/usr/bin/env python3
"""Resumable Projects v2 provisioning; offline plan by default, --apply to write.
Uses existing issue IDs. Never changes issue state/assignees or existing Status,
Agent, Branch, lease, lock or evidence values. Native Projects access is required.
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
from pathlib import Path
from release15 import ROOT, REPO, plan

class BudgetReached(RuntimeError):
    pass


def definitions(manifest, config, p):
    all_ids = sorted(p['items'])
    policy = config['project_policy']
    out = [dict(key='portfolio',title=policy['portfolio_title'],ids=['SF-PORTFOLIO','SF-R015']+all_ids),
           dict(key='release',title=policy['release_title'],ids=['SF-R015']+sorted(p['roles']))]
    out += [dict(key=a['id'],title=policy['area_title'].format(**a),ids=[k for k in all_ids if p['items'][k]['area']==a['id']]) for a in manifest['areas']]
    return out


def metadata(key, p):
    if key not in p['items']:
        return {'SF Work ID':key,'SF Area':'Program','SF Release':'0.15' if key=='SF-R015' else '', 'SF Role':'Tracker','SF Dependencies':''}
    t=p['items'][key]
    return {'SF Work ID':key,'SF Area':t['area'],'SF Release':'0.15' if key in p['roles'] else '',
            'SF Role':p['roles'].get(key,'Full parity'),'SF Dependencies':', '.join(t['dependencies'])}


def choose_project(rows, definition, binding=None):
    marker='<!-- sharpforge-project:'+REPO+':'+definition['key']+' -->'
    if binding is not None:
        matches=[x for x in rows if x['number']==binding]
    else:
        matches=[x for x in rows if marker in (x.get('readme') or '')]
        collisions=[x for x in rows if x['title']==definition['title'] and x not in matches]
        if collisions:
            raise RuntimeError('An unmarked project already uses this title. Review its URL and use --bindings: '+', '.join(x['url'] for x in collisions))
    if len(matches)>1 or (binding is not None and len(matches)!=1):
        raise RuntimeError('Ambiguous or inaccessible project binding: '+definition['key'])
    return matches[0] if matches else None


def owner_projects(client):
    owner=REPO.split('/')[0];cursor=None;rows=[];owner_id=None
    while True:
        d=client.query('query($o:String!,$c:String){repositoryOwner(login:$o){id ... on User{projectsV2(first:100,after:$c){nodes{id number title url readme closed} pageInfo{hasNextPage endCursor}}} ... on Organization{projectsV2(first:100,after:$c){nodes{id number title url readme closed} pageInfo{hasNextPage endCursor}}}}}',{'o':owner,'c':cursor})['repositoryOwner']
        if not d:
            raise RuntimeError('Projects owner is unavailable')
        owner_id=d['id'];page=d['projectsV2'];rows+=page['nodes']
        if not page['pageInfo']['hasNextPage']:
            return owner_id,rows
        cursor=page['pageInfo']['endCursor']


def fields(client, project_id):
    result={};cursor=None
    while True:
        d=client.query('query($id:ID!,$c:String){node(id:$id){... on ProjectV2{fields(first:100,after:$c){nodes{... on ProjectV2FieldCommon{id name dataType}} pageInfo{hasNextPage endCursor}}}}}',{'id':project_id,'c':cursor})['node']['fields']
        for f in d['nodes']:
            if f['name'] in result:
                raise RuntimeError('Duplicate field name: '+f['name'])
            result[f['name']]=f
        if not d['pageInfo']['hasNextPage']:
            return result
        cursor=d['pageInfo']['endCursor']


def items(client, project_id):
    result={};cursor=None
    while True:
        d=client.query('query($id:ID!,$c:String){node(id:$id){... on ProjectV2{items(first:100,after:$c){nodes{id content{... on Issue{id}} fieldValues(first:100){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{name}}}} pageInfo{hasNextPage}}} pageInfo{hasNextPage endCursor}}}}}',{'id':project_id,'c':cursor})['node']['items']
        for item in d['nodes']:
            content=item.get('content') or {}
            if not content.get('id'):
                continue  # Preserve inaccessible, draft and PR items untouched.
            if item['fieldValues']['pageInfo']['hasNextPage']:
                raise RuntimeError('Too many field values; explicit reconciliation required')
            item['text']={x['field']['name']:x['text'] for x in item['fieldValues']['nodes'] if 'text' in x}
            if content['id'] in result:
                raise RuntimeError('Duplicate issue membership')
            result[content['id']]=item
        if not d['pageInfo']['hasNextPage']:
            return result
        cursor=d['pageInfo']['endCursor']


def safe_values(current, desired):
    updates={}
    for name,value in desired.items():
        old=current.get(name,'')
        if old and old!=value:
            raise RuntimeError('Preserving conflicting existing metadata; reconcile field '+name)
        if value and not old:
            updates[name]=value
    return updates


def provision(client, manifest, config, p, wanted, bindings, audit):
    rid, links=client.issues()
    defs=[x for x in definitions(manifest,config,p) if wanted=='all' or x['key']==wanted]
    if not defs:
        raise ValueError('Unknown project selector')
    missing=set(k for d in defs for k in d['ids'])-set(links)
    if missing:
        raise RuntimeError('Provision existing release issues first: '+','.join(sorted(missing)))
    owner_id,rows=owner_projects(client)
    # All naming/access conflicts are discovered before creating any project.
    choices={d['key']:choose_project(rows,d,bindings.get(d['key'])) for d in defs}
    for d in defs:
        project=choices[d['key']]
        if project and project['closed']:
            raise RuntimeError('Project is closed; will not reopen automatically: '+project['url'])
        if not project:
            project=client.query('mutation($i:CreateProjectV2Input!){createProjectV2(input:$i){projectV2{id number title url closed}}}',{'i':{'ownerId':owner_id,'repositoryId':rid,'title':d['title']}})['createProjectV2']['projectV2']
            audit['created'].append(project['url'])
            readme='<!-- sharpforge-project:'+REPO+':'+d['key']+' -->\n\n# '+d['title']+'\n\nCanonical issue ownership remains in the area hierarchy. Do not duplicate issues per board or count epics as delivered leaf work. Claim one leaf with an explicit lease, branch, paths and evidence. Status alone is not a claim lock.\n\n0.15 tracker: https://github.com/'+REPO+'/issues/422\n\nSuggested views: '+ '; '.join(config['project_policy']['views'])
            client.query('mutation($i:UpdateProjectV2Input!){updateProjectV2(input:$i){projectV2{id}}}',{'i':{'projectId':project['id'],'readme':readme}})
        fs=fields(client,project['id'])
        for name in config['project_policy']['fields']:
            if name in fs:
                if fs[name]['dataType']!='TEXT':
                    raise RuntimeError('Existing field has incompatible type: '+name)
                continue
            f=client.query('mutation($i:CreateProjectV2FieldInput!){createProjectV2Field(input:$i){projectV2Field{... on ProjectV2Field{id name dataType}}}}',{'i':{'projectId':project['id'],'name':name,'dataType':'TEXT'}})['createProjectV2Field']['projectV2Field']
            fs[name]=f
        current=items(client,project['id'])
        for key in d['ids']:
            content_id=links[key]['id'];item=current.get(content_id)
            desired=metadata(key,p)
            changes=safe_values(item['text'] if item else {},desired)
            if not item:
                item=client.query('mutation($i:AddProjectV2ItemByIdInput!){addProjectV2ItemById(input:$i){item{id}}}',{'i':{'projectId':project['id'],'contentId':content_id}})['addProjectV2ItemById']['item']
            for name,value in changes.items():
                client.query('mutation($i:UpdateProjectV2ItemFieldValueInput!){updateProjectV2ItemFieldValue(input:$i){projectV2Item{id}}}',{'i':{'projectId':project['id'],'itemId':item['id'],'fieldId':fs[name]['id'],'value':{'text':value}}})
        # Read back membership and metadata, not just mutation responses.
        verified=items(client,project['id'])
        for key in d['ids']:
            item=verified.get(links[key]['id'])
            if not item or safe_values(item['text'],metadata(key,p)):
                raise RuntimeError('Incomplete project read-back: '+key)
        audit['verified'].append({'key':d['key'],'url':project['url'],'items':len(d['ids'])})
        print('Verified project',d['key'],project['url'],flush=True)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--apply',action='store_true')
    ap.add_argument('--project',default='release',help='release, portfolio, A00..A29 or all')
    ap.add_argument('--bindings',type=Path,help='Explicit JSON mapping project keys to existing owner project numbers')
    ap.add_argument('--max-writes',type=int,default=400,help='Bounded batch; rerun to continue, never resets agent fields')
    a=ap.parse_args()
    if not 1<=a.max_writes<=450:
        ap.error('--max-writes must be between 1 and 450')
    m=json.loads((ROOT/'planning/generated/backlog.json').read_text());c=json.loads((ROOT/'planning/release15.json').read_text());p=plan(m,c)
    ds=definitions(m,c,p)
    if a.project!='all' and a.project not in {d['key'] for d in ds}:
        ap.error('Unknown project selector')
    bindings=json.loads(a.bindings.read_text()) if a.bindings else {}
    if not isinstance(bindings,dict) or any(k not in {d['key'] for d in ds} or type(v)!=int or v<1 for k,v in bindings.items()):
        ap.error('Invalid project bindings')
    if not a.apply:
        print(json.dumps({'dry_run':True,'projects_defined':len(ds),'projects':[dict(key=d['key'],title=d['title'],items=len(d['ids'])) for d in ds if a.project=='all' or d['key']==a.project],'status':'not provisioned'},indent=2));return
    if os.environ.get('GITHUB_REPOSITORY',REPO)!=REPO:
        raise RuntimeError('Wrong repository')
    token=os.environ.get('GH_PROJECT_TOKEN') or os.environ.get('GH_TOKEN')
    if not token:
        proc=subprocess.run(['gh','auth','token'],capture_output=True,text=True,timeout=30)
        if proc.returncode or not proc.stdout.strip():
            raise RuntimeError('Authenticate gh with Projects access or supply GH_PROJECT_TOKEN securely; never paste it into an issue')
        token=proc.stdout.strip()
    from seed import Client
    class BoundedClient(Client):
        def query(self,q,v=None):
            if q.lstrip().startswith('mutation') and self.writes>=a.max_writes:
                raise BudgetReached('Batch budget reached; rerun the same command to resume')
            return super().query(q,v)
    client=BoundedClient(token)
    audit={'status':'incomplete','selector':a.project,'created':[],'verified':[]}
    out=ROOT/'planning/generated/projects-audit.json';out.parent.mkdir(parents=True,exist_ok=True)
    try:
        provision(client,m,c,p,a.project,bindings,audit)
        audit['status']='verified'
    except BudgetReached as e:
        audit['status']='partial-rerun-required';audit['reason']=str(e)
    finally:
        audit['writes']=client.writes;out.write_text(json.dumps(audit,indent=2)+'\n');print(json.dumps(audit,indent=2))
    if audit['status']!='verified':
        raise SystemExit(2)

if __name__=='__main__':main()
