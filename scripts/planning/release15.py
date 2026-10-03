#!/usr/bin/env python3
"""0.15 overlay: reuse existing issues, preserve ownership, add narrow release slices.
Default is offline planning. --apply uses repo-scoped credentials, never project access.
Run backlog.py first. Remote reads resolve stable markers; no guessed issue numbers.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = 'wieslawsoltes/SharpForge'
REL = 'release:0.15'
DEP = 'release:0.15-prerequisite'


def plan(manifest: dict, config: dict) -> dict:
    if config.get('schema') != 1 or config.get('repository') != REPO or manifest.get('repository') != REPO:
        raise ValueError('Unsupported schema or repository')
    if config.get('release') != '0.15' or config.get('tracker') != 'SF-R015':
        raise ValueError('Wrong release/tracker')
    by = {t['id']: dict(t) for t in manifest['items']}
    if len(by) != len(manifest['items']):
        raise ValueError('Duplicate backlog IDs')
    selected = set()
    for area, numbers in config['selections'].items():
        if len(set(numbers)) != len(numbers):
            raise ValueError('Duplicate selection '+area)
        for n in numbers:
            key = f'SF-{area}-T{n:02}'
            if key not in by or by[key]['kind'] != 'task':
                raise ValueError('Unknown selected task '+key)
            selected.add(key)
    for t in config['new_tasks']:
        if t['id'] in by:
            raise ValueError('Duplicate new ID '+t['id'])
        if not t['paths'] or not t['acceptance']:
            raise ValueError('Missing ownership/acceptance '+t['id'])
        by[t['id']] = dict(t, kind='task', write_paths=t['paths'], locks=['area:'+t['area']])
        selected.add(t['id'])
    for t in by.values():
        if t['parent'] != 'SF-PORTFOLIO' and t['parent'] not in by:
            raise ValueError('Unknown parent '+t['parent'])
        if any(d not in by for d in t['dependencies']):
            raise ValueError('Unknown dependency '+t['id'])
    done = set()
    def visit(key, active):
        if key in active:
            raise ValueError('Dependency cycle '+key)
        if key in done:
            return
        active.add(key)
        for dep in by[key]['dependencies']:
            visit(dep, active)
        active.remove(key)
        done.add(key)
    for key in by:
        visit(key, set())
    needed = set()
    def closure(key):
        if key in needed:
            return
        needed.add(key)
        for dep in by[key]['dependencies']:
            closure(dep)
    for key in selected:
        closure(key)
    roles = {key: ('Deliverable' if key in selected else 'Prerequisite') for key in needed}
    # Hierarchy is context, not an implementation dependency. In particular, Rust
    # publishing remains on the broader parent of the JS/SIMD release slice.
    for key in list(roles):
        parent = by[key]['parent']
        seen = set()
        while parent != 'SF-PORTFOLIO':
            if parent in seen:
                raise ValueError('Parent cycle '+parent)
            seen.add(parent)
            roles.setdefault(parent, 'Parent')
            parent = by[parent]['parent']
    return {'schema': 1, 'repository': REPO, 'release': '0.15',
            'tracker': config['tracker'], 'items': by, 'roles': dict(sorted(roles.items())),
            'selected': sorted(selected), 'new_ids': [t['id'] for t in config['new_tasks']],
            'projects_status': 'pending project-scoped authorization'}


def new_body(t: dict, links: dict) -> str:
    link = lambda key: links[key]['url']
    out = [f"<!-- sharpforge-backlog:{t['id']} -->", '# '+t['title'],
           f"Release: [0.15 delivery]({link('SF-R015')}). Area: **{t['area']}**. Parent: [{t['parent']}]({link(t['parent'])}).",
           '## Deliverable', t['deliverable'], '## Acceptance criteria']
    out += ['- [ ] '+a for a in t['acceptance']]
    out += ['## Dependencies']
    out += ['- ['+d+']('+link(d)+')' for d in t['dependencies']] or ['No code prerequisite; an ownership lease is still required.']
    out += ['## Parallel-agent ownership', 'Write only: '+', '.join('`'+p+'`' for p in t['write_paths']),
            'These are proposed paths, not claims that modules already exist. Claim a narrow file lease before coding. The parent task must not have another agent editing the same implementation concurrently.',
            'Shared framework IDs, runtime dispatchers and studio.js remain owned by A00/A19 integration. Submit an adapter request instead of editing another area. Keep product implementation out of qualification-only tasks.',
            '## Handoff and completion',
            'Agent: unassigned. Branch: not created. Lease: not claimed. Record last verified commit, exact paths, heartbeat/expiry, prerequisites, commands, artifacts and blockers. A project card is not a lock or proof of readiness.',
            'Add positive/negative, cancellation/disposal and cross-engine tests as applicable. Close only with merged, reproducible evidence. Unsupported platforms and missing real-hardware/provider tests remain explicit. Do not close broader parity parents when only this slice is complete.']
    return '\n\n'.join(out)+'\n'


def ensure_comment(client, issue, tag, body):
    marker = '<!-- sharpforge-release15:'+tag+' -->'
    text = marker+'\n\n'+body
    cursor = None
    matches = []
    while True:
        data = client.query('query($id:ID!,$c:String){node(id:$id){... on Issue{comments(first:100,after:$c){nodes{id body} pageInfo{hasNextPage endCursor}}}}}', {'id':issue['id'],'c':cursor})['node']['comments']
        matches += [c for c in data['nodes'] if marker in c['body']]
        if not data['pageInfo']['hasNextPage']:
            break
        cursor = data['pageInfo']['endCursor']
    if len(matches) > 1:
        raise RuntimeError('Duplicate managed release comments on '+issue['url'])
    if matches:
        # Do not replace later human edits or reset task-list state.
        return False
    client.query('mutation($i:AddCommentInput!){addComment(input:$i){commentEdge{node{id}}}}', {'i':{'subjectId':issue['id'],'body':text}})
    return True


def apply(client, p: dict, config: dict, out: Path) -> dict:
    rid, links = client.issues()
    required = (set(p['roles'])-set(p['new_ids'])) | {'SF-PORTFOLIO','SF-R015'}
    missing = required-set(links)
    if missing:
        raise RuntimeError('Existing backlog incomplete; seed it first: '+','.join(sorted(missing)))
    # Check all existing native parents before writing; release membership must
    # never steal tasks from their area epics.
    for key in required-{'SF-PORTFOLIO','SF-R015'}:
        parent = p['items'][key]['parent']
        if (links[key].get('parent') or {}).get('id') != links[parent]['id']:
            raise RuntimeError('Reconcile existing parent before release tagging: '+key)
    labels = client.labels()
    for name, color in [(REL,'0052CC'),(DEP,'BFD4F2')]:
        if name not in labels:
            data = client.query('mutation($i:CreateLabelInput!){createLabel(input:$i){label{id}}}', {'i':{'repositoryId':rid,'name':name,'color':color,'description':'0.15 scope overlay; preserves full-parity ownership'}})
            labels[name] = data['createLabel']['label']['id']
    current_parent = (links['SF-R015'].get('parent') or {}).get('id')
    if current_parent and current_parent != links['SF-PORTFOLIO']['id']:
        raise RuntimeError('Release tracker already has another parent')
    if not current_parent:
        client.query('mutation($i:AddSubIssueInput!){addSubIssue(input:$i){issue{id}}}', {'i':{'issueId':links['SF-PORTFOLIO']['id'],'subIssueId':links['SF-R015']['id'],'replaceParent':False}})
    created = []
    todo = set(p['new_ids'])
    while todo:
        progress = False
        for key in sorted(todo):
            t = p['items'][key]
            if any(d not in links for d in t['dependencies']):
                continue
            if key not in links:
                names = [REL,'area:'+t['area'],'kind:task','priority:'+t['priority'],'state:blocked' if t['dependencies'] else 'state:ready']
                if any(n not in labels for n in names):
                    raise RuntimeError('Missing pre-existing planning label')
                d = client.query('mutation($i:CreateIssueInput!){createIssue(input:$i){issue{id number url title state parent{id}}}}', {'i':{'repositoryId':rid,'title':'['+key+'] '+t['title'],'body':new_body(t,links),'parentIssueId':links[t['parent']]['id'],'labelIds':[labels[n] for n in names]}})['createIssue']['issue']
                links[key] = d
                created.append(key)
                print('Created',key,d['url'],flush=True)
            if (links[key].get('parent') or {}).get('id') != links[t['parent']]['id']:
                raise RuntimeError('Wrong native parent for '+key)
            todo.remove(key)
            progress = True
        if not progress:
            raise RuntimeError('Unresolved new-task prerequisites')
    # Native blockers for the new slices; never remove existing dependencies.
    for key in p['new_ids']:
        t = p['items'][key]
        d = client.query('query($id:ID!){node(id:$id){... on Issue{blockedBy(first:100){nodes{id} pageInfo{hasNextPage}}}}}', {'id':links[key]['id']})['node']['blockedBy']
        if d['pageInfo']['hasNextPage']:
            raise RuntimeError('Unexpectedly many existing blockers; reconcile explicitly')
        existing = {x['id'] for x in d['nodes']}
        for dep in t['dependencies']:
            if links[dep]['id'] not in existing:
                client.query('mutation($i:AddBlockedByInput!){addBlockedBy(input:$i){issue{id}}}', {'i':{'issueId':links[key]['id'],'blockingIssueId':links[dep]['id']}})
    tagged = 0
    for key, role in p['roles'].items():
        name = DEP if role == 'Prerequisite' else REL
        present = {x['name'] for x in links[key].get('labels',{}).get('nodes',[])}
        if name not in present and key not in created:
            client.query('mutation($i:AddLabelsToLabelableInput!){addLabelsToLabelable(input:$i){clientMutationId}}', {'i':{'labelableId':links[key]['id'],'labelIds':[labels[name]]}})
            tagged += 1
    notes = 0
    areas = sorted({p['items'][k]['area'] for k in p['selected']})
    for area in areas:
        for n in [1,2]:
            epic = f'SF-{area}-E{n:02}'
            if epic not in p['roles']:
                continue
            children = []
            for key in p['selected']:
                t = p['items'][key]
                parent = t['parent']
                while parent != 'SF-PORTFOLIO' and parent != epic:
                    parent = p['items'][parent]['parent']
                if parent == epic:
                    children.append(key)
            if not children:
                continue
            body = '## Explicit 0.15 scope\n\nRelease tracker: #'+str(links['SF-R015']['number'])+'. Reuse the native area hierarchy below; do not duplicate these issues in a separate release implementation.\n\n'
            body += '\n'.join('- [ ] #'+str(links[k]['number'])+' — '+k+': '+p['items'][k]['title'] for k in children)
            body += '\n\nOne leaf per agent with a narrow file lease. Preserve original dependencies and test gates. The same issue belongs to its area project and the release view. A release slice does not close broader parity parents. Project provisioning requires separately authorized Projects access.'
            notes += ensure_comment(client, links[epic], epic, body)
    resolved = {k: dict(p['items'][k],role=role,number=links[k]['number'],url=links[k]['url'],node_id=links[k]['id']) for k,role in p['roles'].items()}
    text = '## Resolved 0.15 issue index\n\nImplementation issues are reused; existing native parents and assignments are preserved.\n\n'
    for area in areas:
        text += '\n### '+area+'\n'
        text += '\n'.join('- [ ] #'+str(links[k]['number'])+' — '+p['items'][k]['title'] for k in p['selected'] if p['items'][k]['area']==area)+'\n'
    text += '\n### Publishing scope clarification\nSF-A26-T06 remains a broader parent (including Rust); SF-R015-T03 owns the existing JS/Wasm-SIMD 0.15 profile. Its parent and Rust prerequisites are not removed or falsely completed.\n\nProjects: 30 area definitions plus portfolio and a 0.15 view are configured in planning. Native boards/membership require a successful project-scoped provisioning audit, not just this comment. No product capability is marked done by this update.'
    notes += ensure_comment(client, links['SF-R015'], 'release-index', text)
    notes += ensure_comment(client, links['SF-PORTFOLIO'], 'portfolio-index', '## 0.15 is included\n\nTrack the explicit scope and resolved existing/new leaf issues in #'+str(links['SF-R015']['number'])+'. This is an ownership-preserving overlay, not a duplicate implementation backlog. Area and release boards must reference the same issues. Project setup remains separately authorized and verified.')
    _, verified = client.issues()
    for key, role in p['roles'].items():
        expected = DEP if role == 'Prerequisite' else REL
        if expected not in {x['name'] for x in verified[key]['labels']['nodes']}:
            raise RuntimeError('Read-back missing label: '+key)
        if (verified[key].get('parent') or {}).get('id') != verified[p['items'][key]['parent']]['id']:
            raise RuntimeError('Read-back changed parent: '+key)
    if (verified['SF-R015'].get('parent') or {}).get('id') != verified['SF-PORTFOLIO']['id']:
        raise RuntimeError('Release native parent was not confirmed')
    # Re-read blockers; successful mutation responses alone are not verification.
    for key in p['new_ids']:
        d = client.query('query($id:ID!){node(id:$id){... on Issue{blockedBy(first:100){nodes{id} pageInfo{hasNextPage}}}}}', {'id':verified[key]['id']})['node']['blockedBy']
        ids = {x['id'] for x in d['nodes']}
        if not {verified[x]['id'] for x in p['items'][key]['dependencies']} <= ids:
            raise RuntimeError('Read-back missing blockers '+key)
    result = {'release':'0.15','tracker':verified['SF-R015']['url'],
              'existing_deliverables_reused':len(p['selected'])-len(p['new_ids']),
              'new_slices_verified':len(p['new_ids']),'created_this_run':len(created),
              'prerequisites':sum(v=='Prerequisite' for v in p['roles'].values()),
              'parent_context':sum(v=='Parent' for v in p['roles'].values()),
              'tagged_this_run':tagged,'comments_added':notes,
              'native_parent_and_new_dependency_links':'verified',
              'project_status':'pending project-scoped authorization',
              'new_issues':{k:verified[k]['url'] for k in p['new_ids']}}
    out.mkdir(parents=True,exist_ok=True)
    (out/'release15-state.json').write_text(json.dumps({'result':result,'items':resolved,'tracker':verified['SF-R015'],'portfolio':verified['SF-PORTFOLIO']},indent=2)+'\n')
    (out/'release15-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
            f.write('## 0.15 backlog read-back\n```json\n'+json.dumps(result,indent=2)+'\n```\n')
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--apply',action='store_true')
    args = ap.parse_args()
    m = json.loads((ROOT/'planning/generated/backlog.json').read_text())
    c = json.loads((ROOT/'planning/release15.json').read_text())
    p = plan(m,c)
    if not args.apply:
        print(json.dumps({'dry_run':True,'existing_tasks':len(p['selected'])-len(p['new_ids']),'new_tasks':len(p['new_ids']),'roles':{r:sum(v==r for v in p['roles'].values()) for r in ['Deliverable','Prerequisite','Parent']},'projects':'not provisioned'},indent=2))
        return
    if os.environ.get('GITHUB_REPOSITORY',REPO) != REPO:
        raise RuntimeError('Refusing a different repository')
    from seed import Client
    apply(Client(os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')),p,c,ROOT/'planning/generated')

if __name__ == '__main__':
    main()
