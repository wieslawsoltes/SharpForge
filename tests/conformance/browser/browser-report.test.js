import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mergeCells,validateCell} from '../../../scripts/conformance/browser-report.js';
const cell=(extra={})=>({schemaVersion:1,engine:'chromium',mode:'http',category:'served',suite:'smoke',device:null,platform:'linux',browserVersion:'145.0',playwright:'1.57.0',source:{commit:'a'.repeat(40),dirty:false},checks:[{id:'run',status:'passed'}],passed:true,parityPassed:true,emulated:false,hardwareQualified:false,...extra});
test('browser report preserves served, file, harness and deployed categories',()=>{
 const rows=[cell(),cell({mode:'file'}),cell({mode:'in-memory',category:'harness'}),cell({mode:'deployed',category:'deployed',navigation:{url:'https://example.test/',status:200,policy:{value:"script-src 'self'"}}})];
 assert.equal(mergeCells(rows).summary.hardware,0);assert.ok(mergeCells(rows).unmeasured.some(x=>x.platform==='windows'&&x.engine==='webkit'));assert.equal(mergeCells(rows).unmeasured.some(x=>x.platform==='linux'&&x.engine==='chromium'&&x.mode==='http'&&x.suite==='smoke'),false);assert.equal(mergeCells(rows).rows.length,4);
});
test('emulation and relabelled harnesses cannot acquire hardware/deployment qualification',()=>{
 for(const row of [cell({hardwareQualified:true}),cell({category:'deployed'}),cell({mode:'hardware',category:'hardware',emulated:true}),cell({mode:'hardware',category:'hardware',emulated:false})])assert.throws(()=>validateCell(row));
});
test('hardware requires target/revision/digest bound physical evidence',()=>{
 const row=cell({mode:'hardware',category:'hardware',hardwareQualified:true});
 const proof={kind:'physical-device-observation',deviceId:'lab-device-1',operator:'qualification-lab',observedAt:'2026-10-03T00:00:00Z',engine:row.engine,platform:row.platform,browserVersion:row.browserVersion,commit:row.source.commit,reportSha256:createHash('sha256').update(JSON.stringify(row)).digest('hex')};
 assert.equal(validateCell(row,{hardwareEvidence:proof}),row);
 for(const changes of [{platform:'windows'},{commit:'b'.repeat(40)},{reportSha256:'0'.repeat(64)}])assert.throws(()=>validateCell(row,{hardwareEvidence:{...proof,...changes}}));
});
test('known/unsupported rows never count as full parity and contradictions fail closed',()=>{
 const row=cell({checks:[{id:'shared-memory',status:'unsupported',reason:'No product path'}],parityPassed:false});
 assert.equal(mergeCells([row]).summary.parityPassed,0);
 const known=cell({checks:[{id:'product-gap',status:'known-failure'}],passed:false,parityPassed:false});
 assert.equal(mergeCells([known]).summary.passed,0);
 assert.throws(()=>mergeCells([{...known,passed:true}]));
 assert.throws(()=>mergeCells([{...row,parityPassed:true}]));
 assert.throws(()=>mergeCells([cell(),cell()]));
 assert.throws(()=>mergeCells([cell({checks:[]})]));
 assert.throws(()=>mergeCells([cell({checks:[{id:'run',status:'passed'},{id:'run',status:'passed'}]})]));
});
