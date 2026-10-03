import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {bindSources,readPortablePdb,sourceSpan} from '@sharpforge/symbols';
import {ProtocolMessageReader,encodeProtocolMessage} from '@sharpforge/protocol';
test('PDB: 12000 source statements map exactly without per-point whole-document rescanning',()=>{
 const text=Array.from({length:12000},(_,i)=>`Console.WriteLine(${i}); // viewport ${i}\n`).join('');
 const c=compileToIL(text);assert(c.success);const b=bindSources(readPortablePdb(c.pdb));assert.equal(b.sequencePoints.length,12000);
 for(const i of [0,1,4999,11999]){const p=b.sequencePoints[i];assert.equal(p.line,i+1);assert.equal(text.slice(p.start,p.end),`Console.WriteLine(${i});`);}
});
test('PDB: UTF-16 columns and CRLF retain exact source offsets',()=>{
 const text='//😀\r\nint x=1;\r\nConsole.WriteLine(x);';const c=compileToIL(text);assert(c.success);
 const b=bindSources(readPortablePdb(c.pdb));for(const p of b.sequencePoints)assert.equal(p.column,1);
 assert.equal(text.slice(b.sequencePoints.at(-1).start,b.sequencePoints.at(-1).end),'Console.WriteLine(x);');
 assert.deepEqual(sourceSpan(text,text.indexOf('int'),text.indexOf('int')+8),{line:2,column:1,endLine:2,endColumn:9});
});
test('PDB: checksum-matching source with impossible sequence coordinates is rejected',()=>{
 const c=compileToIL('int x=1;');const s=readPortablePdb(c.pdb);s.methods.find(m=>m.points.length).points[0].endLine=9000;assert.throws(()=>bindSources(s),/verified source/);
});
test('language: WinUI completion includes inherited properties, event handlers and methods',()=>{
 const w=new Workspace();const s='using Microsoft.UI.Xaml.Controls;Button button=new Button();button.';w.update('Program.cs',s,1);const l=new LanguageService(w),items=l.completions('Program.cs',s.length);
 for(const name of ['Content','Width','Click','FindName'])assert(items.some(i=>i.label===name),name);
 w.update('Program.cs','using Microsoft.UI.Xaml.Controls;Button button=new Button();',2);assert.match(l.hover('Program.cs',35).contents,/Button|Controls/);
});
function client(){const child=spawn(process.execPath,[resolve('packages/protocol/bin/sharpforge-dap.js')]),r=new ProtocolMessageReader(),messages=[];let sequence=0,stderr='';child.stdout.on('data',chunk=>messages.push(...r.feed(chunk)));child.stderr.on('data',chunk=>stderr+=chunk);const wait=async fn=>{const until=Date.now()+8000;while(!messages.some(fn)){if(Date.now()>until)throw Error('Protocol timeout '+stderr+' '+JSON.stringify(messages));await new Promise(r=>setTimeout(r,10));}return messages.find(fn);};return {child,messages,wait,request:async(command,args={})=>{const seq=++sequence;child.stdin.write(encodeProtocolMessage({seq,type:'request',command,arguments:args}));const m=await wait(x=>x.request_seq===seq);assert(m.success,m.message);return m.body;}};}
test('actual DAP stdio: disk DLL + sidecar, verified source, local evaluation and goto',async()=>{
 const c=client();try{await c.request('initialize');await c.request('launch',{program:resolve('examples/managed/PortableSymbols.dll'),pdbPath:'PortableSymbols.pdb',methodToken:JSON.parse(readFileSync('examples/managed/PortableSymbols.fixture.json')).entryToken,stopOnEntry:true});await c.request('configurationDone');await c.wait(x=>x.event==='stopped');let stack=await c.request('stackTrace',{threadId:1});assert.equal(stack.stackFrames[0].line,3);await c.request('next',{threadId:1});await c.wait(x=>x.event==='stopped'&&x.body.reason==='step');stack=await c.request('stackTrace',{threadId:1});assert.equal(stack.stackFrames[0].line,4);assert.equal((await c.request('evaluate',{frameId:stack.stackFrames[0].id,expression:'value'})).result,'20');const t=await c.request('gotoTargets',{source:{path:'external/ExternalProgram.cs'},line:5});await c.request('goto',{targetId:t.targets[0].id,threadId:1});await c.request('continue',{threadId:1});await c.wait(x=>x.event==='terminated');assert(c.messages.some(x=>x.event==='output'&&x.body.output.includes('20')));}finally{c.child.kill();}
});
