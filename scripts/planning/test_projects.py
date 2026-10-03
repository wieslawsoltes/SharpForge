import copy
import json
import unittest
from pathlib import Path
import projects as g
from release15 import plan

ROOT=Path(__file__).resolve().parents[2]
M=json.loads((ROOT/'planning/generated/backlog.json').read_text())
C=json.loads((ROOT/'planning/release15.json').read_text())
P=plan(M,C)

class Fake:
    def __init__(self):
        self.projects={};self.fieldmap={};self.itemmap={};self.writes=0;self.limit=100000
        self.links={k:{'id':k,'url':'https://github.com/'+g.REPO+'/issues/'+str(i)} for i,k in enumerate(['SF-PORTFOLIO','SF-R015']+list(P['items']),1)}
    def issues(self):return 'REPO',copy.deepcopy(self.links)
    def query(self,q,v=None):
        v=v or {};i=v.get('i',{})
        if q.startswith('mutation'):
            if self.writes>=self.limit:raise g.BudgetReached('limit')
            self.writes+=1
            if 'createProjectV2(' in q:
                n=len(self.projects)+1;key='proj:'+str(n)
                row=dict(id=key,number=n,title=i['title'],url='https://github.com/users/example/projects/'+str(n),readme='',closed=False)
                self.projects[key]=row;self.fieldmap[key]={};self.itemmap[key]={}
                return {'createProjectV2':{'projectV2':copy.deepcopy(row)}}
            if 'updateProjectV2(' in q:
                self.projects[i['projectId']]['readme']=i['readme'];return {'updateProjectV2':{'projectV2':{'id':i['projectId']}}}
            if 'createProjectV2Field(' in q:
                row=dict(id=i['projectId']+':field:'+i['name'],name=i['name'],dataType=i['dataType'])
                self.fieldmap[i['projectId']][i['name']]=row
                return {'createProjectV2Field':{'projectV2Field':copy.deepcopy(row)}}
            if 'addProjectV2ItemById(' in q:
                key=i['contentId'];row=self.itemmap[i['projectId']].setdefault(key,dict(id=i['projectId']+':item:'+key,content={'id':key},text={},status='Todo'))
                return {'addProjectV2ItemById':{'item':{'id':row['id']}}}
            if 'updateProjectV2ItemFieldValue(' in q:
                row=next(x for x in self.itemmap[i['projectId']].values() if x['id']==i['itemId'])
                name=next(x['name'] for x in self.fieldmap[i['projectId']].values() if x['id']==i['fieldId'])
                self.assert_machine(name);row['text'][name]=i['value']['text']
                return {'updateProjectV2ItemFieldValue':{'projectV2Item':{'id':row['id']}}}
        if 'repositoryOwner(' in q:
            return {'repositoryOwner':{'id':'OWNER','projectsV2':self.page(list(self.projects.values()),v.get('c'))}}
        if 'fields(' in q:
            return {'node':{'fields':self.page(list(self.fieldmap[v['id']].values()),v.get('c'))}}
        if 'items(' in q:
            rows=[]
            for item in self.itemmap[v['id']].values():
                row=copy.deepcopy(item);row['fieldValues']={'nodes':[{'text':text,'field':{'name':name}} for name,text in row['text'].items()],'pageInfo':{'hasNextPage':False}}
                rows.append(row)
            return {'node':{'items':self.page(rows,v.get('c'))}}
        raise AssertionError(q)
    @staticmethod
    def assert_machine(name):
        if name not in ['SF Work ID','SF Area','SF Release','SF Role','SF Dependencies']:raise AssertionError('Modified human field '+name)
    @staticmethod
    def page(rows,cursor):
        start=int(cursor or 0);end=start+100
        return {'nodes':copy.deepcopy(rows[start:end]),'pageInfo':{'hasNextPage':end<len(rows),'endCursor':str(end)}}


def audit():return {'created':[],'verified':[]}

def run(f,wanted='release',bindings=None):
    a=audit();g.provision(f,M,C,P,wanted,bindings or {},a);return a

class ProjectTests(unittest.TestCase):
    def test_32_definitions(self):
        ds=g.definitions(M,C,P);self.assertEqual(len(ds),32)
        self.assertEqual(len(next(d for d in ds if d['key']=='release')['ids']),129)
        self.assertEqual(len(next(d for d in ds if d['key']=='portfolio')['ids']),426)
    def test_ownership_membership(self):
        ds=g.definitions(M,C,P)
        for key,t in P['items'].items():
            owners=[d['key'] for d in ds if d['key'].startswith('A') and key in d['ids']]
            self.assertEqual(owners,[t['area']])
    def test_unknown_selector_before_write(self):
        f=Fake()
        with self.assertRaises(ValueError):run(f,'other')
        self.assertEqual(f.writes,0)
    def test_missing_issue_before_write(self):
        f=Fake();del f.links['SF-A18-T02']
        with self.assertRaises(RuntimeError):run(f)
        self.assertEqual(f.writes,0)
    def test_title_collision_refuses_adoption(self):
        f=Fake();title=next(d['title'] for d in g.definitions(M,C,P) if d['key']=='release')
        f.query('mutation createProjectV2(',{'i':{'title':title}});f.writes=0
        with self.assertRaises(RuntimeError):run(f)
        self.assertEqual(f.writes,0)
    def test_explicit_binding_preserves_readme(self):
        f=Fake();f.query('mutation createProjectV2(',{'i':{'title':'Existing board'}});f.projects['proj:1']['readme']='User description'
        run(f,bindings={'release':1});self.assertEqual(f.projects['proj:1']['readme'],'User description');self.assertEqual(len(f.projects),1)
    def test_closed_board_is_not_reopened(self):
        f=Fake();f.query('mutation createProjectV2(',{'i':{'title':'Existing'}});f.projects['proj:1']['closed']=True;f.writes=0
        with self.assertRaises(RuntimeError):run(f,bindings={'release':1})
        self.assertEqual(f.writes,0)
    def test_repeat_is_noop(self):
        f=Fake();a=run(f);w=f.writes;b=run(f)
        self.assertEqual(w,f.writes);self.assertEqual(len(a['created']),1);self.assertFalse(b['created']);self.assertEqual(a['verified'][0]['items'],129)
    def test_partial_batch_resumes(self):
        f=Fake();f.limit=57
        with self.assertRaises(g.BudgetReached):run(f)
        f.limit=10000;run(f);self.assertEqual(len(f.projects),1);self.assertEqual(len(f.itemmap['proj:1']),129)
    def test_machine_metadata_conflict_not_overwritten(self):
        f=Fake();run(f);row=f.itemmap['proj:1']['SF-A18-T02'];row['text']['SF Area']='User override';w=f.writes
        with self.assertRaises(RuntimeError):run(f)
        self.assertEqual(row['text']['SF Area'],'User override');self.assertEqual(f.writes,w)
    def test_human_fields_unrelated_items_and_status_preserved(self):
        f=Fake();run(f);row=f.itemmap['proj:1']['SF-A18-T02'];row['text'].update(Agent='agent-7',Branch='feature/foo',Evidence='run-1');row['status']='In Progress'
        f.itemmap['proj:1']['unrelated']={'id':'unrelated-item','content':{'id':'external-issue'},'text':{'Agent':'other-agent'},'status':'Done'}
        before=copy.deepcopy(f.itemmap);w=f.writes;run(f)
        self.assertEqual(before,f.itemmap);self.assertEqual(w,f.writes)
    def test_incompatible_field_type_preserved(self):
        f=Fake();run(f);f.fieldmap['proj:1']['Agent']['dataType']='SINGLE_SELECT';w=f.writes
        with self.assertRaises(RuntimeError):run(f)
        self.assertEqual(w,f.writes)
    def test_duplicate_project_markers(self):
        d=next(d for d in g.definitions(M,C,P) if d['key']=='release');marker='<!-- sharpforge-project:'+g.REPO+':release -->'
        rows=[dict(number=i,title='x',readme=marker,url='url') for i in [1,2]]
        with self.assertRaises(RuntimeError):g.choose_project(rows,d)
    def test_all_area_definitions_and_portfolio(self):
        f=Fake();a=run(f,'all');self.assertEqual(len(a['verified']),32);w=f.writes;run(f,'all');self.assertEqual(f.writes,w)
    def test_does_not_clear_populated_metadata(self):
        with self.assertRaises(RuntimeError):g.safe_values({'SF Release':'0.14'},{'SF Release':''})
        self.assertEqual(g.safe_values({'Agent':'agent'},{'SF Work ID':'ID'}),{'SF Work ID':'ID'})

if __name__=='__main__':unittest.main()
