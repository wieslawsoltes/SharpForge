import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('release15',HERE/'release15.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
ROOT=HERE.parents[1]
M=json.loads((ROOT/'planning/generated/backlog.json').read_text())
C=json.loads((ROOT/'planning/release15.json').read_text())

class Fake:
    def __init__(self):
        self.rows={};self.comments={};self.blocked={};self.writes=0
        self.labelmap={n:'label:'+n for n in ['kind:task','priority:P0','priority:P1','state:blocked','state:ready']+[f'area:A{x:02}' for x in range(30)]}
        for n,t in enumerate([dict(id='SF-PORTFOLIO',title='Portfolio',parent=None),dict(id='SF-R015',title='Release',parent=None)]+M['items'],1):
            self.rows[t['id']]={'id':t['id'],'number':n,'title':t['title'],'body':f"<!-- sharpforge-backlog:{t['id']} -->",'url':'https://github.com/'+r.REPO+'/issues/'+str(n),'state':'OPEN','assignees':['unchanged-owner'],'parent':{'id':t['parent']} if t['parent'] else None,'labels':{'nodes':[]}}
        self.fail_after_create=False
    def issues(self):return 'REPO',copy.deepcopy(self.rows)
    def labels(self):return dict(self.labelmap)
    def query(self,q,v=None):
        v=v or {};i=v.get('i',{})
        if q.startswith('mutation'):
            self.writes+=1
            if 'createLabel' in q:
                self.labelmap[i['name']]='label:'+i['name'];return {'createLabel':{'label':{'id':self.labelmap[i['name']]}}}
            if 'addSubIssue' in q:
                self.rows[i['subIssueId']]['parent']={'id':i['issueId']};return {'addSubIssue':{'issue':{'id':i['issueId']}}}
            if 'createIssue' in q:
                key=i['title'].split(']')[0][1:];n=1000+len(self.rows)
                row=dict(id=key,number=n,url='https://github.com/'+r.REPO+'/issues/'+str(n),title=i['title'],body=i['body'],state='OPEN',parent={'id':i['parentIssueId']},labels={'nodes':[{'id':l,'name':l.removeprefix('label:')} for l in i['labelIds']]},assignees=[])
                self.rows[key]=row
                if self.fail_after_create:
                    self.fail_after_create=False;raise RuntimeError('ambiguous simulated write')
                return {'createIssue':{'issue':copy.deepcopy(row)}}
            if 'addBlockedBy' in q:
                self.blocked.setdefault(i['issueId'],set()).add(i['blockingIssueId']);return {'addBlockedBy':{'issue':{'id':i['issueId']}}}
            if 'addLabelsToLabelable' in q:
                row=self.rows[i['labelableId']]
                for l in i['labelIds']:
                    if l not in [x['id'] for x in row['labels']['nodes']]:row['labels']['nodes'].append({'id':l,'name':l.removeprefix('label:')})
                return {'addLabelsToLabelable':{'clientMutationId':None}}
            if 'addComment' in q:
                self.comments.setdefault(i['subjectId'],[]).append({'id':'comment:'+str(self.writes),'body':i['body']});return {'addComment':{'commentEdge':{'node':{'id':'comment:'+str(self.writes)}}}}
        if 'comments(' in q:
            return {'node':{'comments':{'nodes':copy.deepcopy(self.comments.get(v['id'],[])),'pageInfo':{'hasNextPage':False,'endCursor':None}}}}
        if 'blockedBy(' in q:
            return {'node':{'blockedBy':{'nodes':[{'id':k} for k in self.blocked.get(v['id'],set())],'pageInfo':{'hasNextPage':False}}}}
        raise AssertionError(q)

class Tests(unittest.TestCase):
    def test_counts(self):
        p=r.plan(M,C);self.assertEqual(len(p['selected']),87);self.assertEqual(len(p['new_ids']),4);self.assertEqual(len(p['roles']),128)
    def test_no_mutation(self):
        m,c=copy.deepcopy(M),copy.deepcopy(C);r.plan(m,c);self.assertEqual(m,M);self.assertEqual(c,C)
    def test_rust_not_a_release_dependency(self):
        p=r.plan(M,C);self.assertEqual(p['roles']['SF-A26-T06'],'Parent');self.assertFalse(any(k.startswith('SF-A27') for k in p['roles']))
    def test_unknown_selection(self):
        c=copy.deepcopy(C);c['selections']['A18'].append(99)
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_duplicate_selection(self):
        c=copy.deepcopy(C);c['selections']['A18'].append(1)
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_duplicate_new_task(self):
        c=copy.deepcopy(C);c['new_tasks'][0]['id']='SF-A18-T01'
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_unknown_dependency(self):
        c=copy.deepcopy(C);c['new_tasks'][0]['dependencies']=['NOPE']
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_dependency_cycle(self):
        c=copy.deepcopy(C);c['new_tasks'][0]['dependencies']=['SF-R015-T04']
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_parent_cycle(self):
        c=copy.deepcopy(C);c['new_tasks'][0]['parent']='SF-R015-T04';c['new_tasks'][3]['parent']='SF-R015-T01'
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_wrong_repository(self):
        c=copy.deepcopy(C);c['repository']='elsewhere/repo'
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_empty_ownership(self):
        c=copy.deepcopy(C);c['new_tasks'][0]['paths']=[]
        with self.assertRaises(ValueError):r.plan(M,c)
    def test_native_links_and_idempotency(self):
        f=Fake();p=r.plan(M,C)
        with tempfile.TemporaryDirectory() as d:
            a=r.apply(f,p,C,Path(d));writes=f.writes;b=r.apply(f,p,C,Path(d))
            self.assertEqual(a['created_this_run'],4);self.assertEqual(b['created_this_run'],0);self.assertEqual(writes,f.writes)
            self.assertEqual(f.rows['SF-R015']['parent']['id'],'SF-PORTFOLIO')
            for k in p['new_ids']:self.assertEqual(f.rows[k]['parent']['id'],p['items'][k]['parent'])
            self.assertTrue((Path(d)/'release15-state.json').is_file())
    def test_parent_conflict_preflight(self):
        f=Fake();f.rows['SF-A18-T01']['parent']={'id':'wrong'}
        with tempfile.TemporaryDirectory() as d,self.assertRaises(RuntimeError):r.apply(f,r.plan(M,C),C,Path(d))
        self.assertEqual(f.writes,0)
    def test_missing_backlog_preflight(self):
        f=Fake();del f.rows['SF-A18-T02']
        with tempfile.TemporaryDirectory() as d,self.assertRaises(RuntimeError):r.apply(f,r.plan(M,C),C,Path(d))
        self.assertEqual(f.writes,0)
    def test_preserve_assignments_states_and_bodies(self):
        f=Fake();f.rows['SF-A18-T02']['state']='CLOSED';before=copy.deepcopy(f.rows)
        with tempfile.TemporaryDirectory() as d:r.apply(f,r.plan(M,C),C,Path(d))
        for k in before:
            for field in ['body','state','assignees']:
                self.assertEqual(before[k][field],f.rows[k][field])
    def test_resume_ambiguous_create_without_duplicates(self):
        f=Fake();f.fail_after_create=True;p=r.plan(M,C)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):r.apply(f,p,C,Path(d))
            result=r.apply(f,p,C,Path(d))
            self.assertEqual(result['created_this_run'],3)
            self.assertEqual(len([k for k in f.rows if k.startswith('SF-R015-T')]),4)
    def test_preserve_edited_comment(self):
        f=Fake();row=f.rows['SF-R015'];f.comments[row['id']]=[dict(id='c',body='<!-- sharpforge-release15:release-index -->\nUser edits')]
        self.assertFalse(r.ensure_comment(f,row,'release-index','different'));self.assertEqual(f.writes,0)
    def test_duplicate_comment_error(self):
        f=Fake();row=f.rows['SF-R015'];f.comments[row['id']]=[dict(id='c',body='<!-- sharpforge-release15:release-index -->')]*2
        with self.assertRaises(RuntimeError):r.ensure_comment(f,row,'release-index','x')

if __name__=='__main__':unittest.main()
