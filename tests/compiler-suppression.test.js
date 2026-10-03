import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SourceText,diagnostic} from '@sharpforge/text';
import {applySuppression,parsePragmaDirectives,PragmaWarningMap,normalizeDiagnosticId} from '../packages/compiler/src/diagnostics/suppression.js';
import {diagnosticDescriptor} from '../packages/compiler/src/diagnostics/codes.js';
import {parseCompilationOptions} from '../packages/compiler/src/options.js';

// Pinned from real Roslyn by packages/compiler/test/suppression/generate.js; replaying the fixtures needs no .NET.
const pinned=JSON.parse(readFileSync(new URL('../packages/compiler/test/suppression/roslyn-suppression.json',import.meta.url),'utf8'));
const key=d=>`${d.uri}:${d.start}:${d.length}:${d.code}:${d.severity}`;
const sorted=list=>list.map(key).sort();
const settings=f=>({sources:f.sources.map(s=>new SourceText(s.text,s.uri)),options:{...f.options,preprocessorSymbols:f.defines??[]},suppressions:f.suppressions??[],includeDirectiveDiagnostics:true});

test('A02-T37 fixtures are a Roslyn pin covering pragmas, options and SuppressMessage',()=>{
  assert.match(pinned.roslyn,/^\d+\.\d+/);assert(pinned.fixtures.length>=30);
  const names=pinned.fixtures.map(f=>f.name).join('\n');
  for(const topic of ['pragma disable all','nowarn','warnaserror','treat warnings as errors','warning level 0','errors are never suppressed','SuppressMessage','malformed pragmas'])assert(names.includes(topic),topic);
  // The fixtures must be discriminating: every fixture drops, promotes or adds something relative to its raw list, or pins that nothing changes.
  assert(pinned.fixtures.filter(f=>sorted(f.raw).join()!==sorted(f.expected).join()).length>=30);
});
for(const f of pinned.fixtures)test(`A02-T37 final diagnostics match Roslyn: ${f.name}`,()=>{
  const final=applySuppression(f.raw,settings(f));
  assert.deepEqual(sorted(final),sorted(f.expected));
  for(const d of final){
    const raw=f.raw.find(r=>key(r)===key(d)||r.uri===d.uri&&r.start===d.start&&r.code===d.code);
    if(raw)assert.equal(d.message,raw.message);else assert.equal(typeof d.message,'string');
    assert.equal(d.isWarningAsError===true,d.severity==='error'&&raw?.severity!=='error','promoted warnings are flagged');
  }
});
test('A02-T37 catalog warning levels agree with the levels Roslyn attached to the fixture diagnostics',()=>{
  let checked=0;
  for(const f of pinned.fixtures)for(const d of f.raw){const descriptor=diagnosticDescriptor(d.code);if(descriptor){assert.equal(descriptor.warningLevel,d.warningLevel,d.code);checked++;}}
  assert(checked>0);
});
test('A02-T37 warning levels come from the catalog when the diagnostic does not carry one',()=>{
  const source=new SourceText('class C { }','a.cs');
  // In the pinned Roslyn catalog CS1634 is a level 1 warning, CS0108 level 2 and CS0078 level 4; unknown ids count as level 1.
  assert.deepEqual(['CS1634','CS0108','CS0078'].map(c=>diagnosticDescriptor(c).warningLevel),[1,2,4]);
  const list=[diagnostic(source,0,5,'CS1634','m','warning'),diagnostic(source,6,1,'CS0108','m','warning'),diagnostic(source,7,1,'CS0078','m','warning'),diagnostic(source,8,1,'SF2006','m','error'),diagnostic(source,9,1,'XX0001','m','warning')];
  const codes=options=>applySuppression(list,{options}).map(d=>d.code);
  assert.deepEqual(codes({warningLevel:0}),['SF2006']);
  assert.deepEqual(codes({warningLevel:1}),['CS1634','SF2006','XX0001']);
  assert.deepEqual(codes({warningLevel:3}),['CS1634','CS0108','SF2006','XX0001']);
  assert.deepEqual(codes({}),['CS1634','CS0108','CS0078','SF2006','XX0001']);
  assert.deepEqual(applySuppression(list).map(d=>d.code),codes({}));
  // An explicit level on the record wins over the catalog.
  assert.deepEqual(applySuppression([{...list[0],warningLevel:5}],{options:{}}),[]);
});
test('A02-T37 pragma parsing: ids, effect position, diagnostics',()=>{
  const text='class C {\n  #pragma warning disable 168, CS0219 , IDE0051 // why\n#pragma warning restore\n}';
  const {directives,diagnostics}=parsePragmaDirectives(text);
  assert.deepEqual(diagnostics,[]);
  assert.deepEqual(directives.map(d=>[d.action,d.ids]),[['disable',['CS0168','CS0219','IDE0051']],['restore',null]]);
  assert.equal(text.slice(directives[0].start,directives[0].end),'#pragma warning disable 168, CS0219 , IDE0051 // why');
  const map=PragmaWarningMap.fromText(text);
  assert.equal(map.stateAt('CS0168',directives[0].start),'default');
  assert.equal(map.stateAt('CS0168',directives[0].end),'disabled');
  assert.equal(map.stateAt('CS0169',directives[0].end),'default');
  assert.equal(map.stateAt('cs0168',directives[0].end),'default');
  assert.equal(map.stateAt('CS0168',directives[1].end),'default');
  assert.deepEqual(parsePragmaDirectives('#pragma warning oops').diagnostics,[{code:'CS1634',args:[],start:16,length:4}]);
  assert.deepEqual(parsePragmaDirectives('#if X\n#pragma warning disable\n#endif').directives,[]);
  assert.equal(parsePragmaDirectives('#if X\n#pragma warning disable\n#endif',{preprocessorSymbols:['X']}).directives.length,1);
});
test('A02-T37 id normalisation and option shapes',()=>{
  assert.equal(normalizeDiagnosticId(168),'CS0168');assert.equal(normalizeDiagnosticId('0168'),'CS0168');assert.equal(normalizeDiagnosticId(' CS0168 '),'CS0168');assert.equal(normalizeDiagnosticId('IDE0051'),'IDE0051');assert.equal(normalizeDiagnosticId('12345'),'CS12345');
  const source=new SourceText('class C { void M() { int a; int b = 1; } }','a.cs');
  const list=[{...diagnostic(source,25,1,'CS0168','m','warning'),warningLevel:3},{...diagnostic(source,32,1,'CS0219','m','warning'),warningLevel:3}];
  const codes=options=>applySuppression(list,{sources:[source],options}).map(d=>d.code+(d.severity==='error'?'!':''));
  assert.deepEqual(codes({noWarn:'168;CS0219'}),[]);
  assert.deepEqual(codes({noWarn:'168, 9999'}),['CS0219']);
  assert.deepEqual(codes({warnAsError:true}),['CS0168!','CS0219!']);
  assert.deepEqual(codes({warnAsError:'0219'}),['CS0168','CS0219!']);
  assert.deepEqual(codes({treatWarningsAsErrors:true,warnNotAsError:[168]}),['CS0168','CS0219!']);
  // The typed options of SF-A02-T38 feed the filter directly.
  const {options,diagnostics}=parseCompilationOptions({noWarn:['219'],treatWarningsAsErrors:true,warningLevel:3});
  assert.deepEqual(diagnostics,[]);assert.deepEqual(codes(options),['CS0168!']);
  // Inputs are not mutated and untouched diagnostics keep their identity.
  const out=applySuppression(list,{options:{}});assert.equal(out[0],list[0]);assert.equal(list[0].severity,'warning');
  // Sources may be a Map of SourceText (Compilation.sources), an iterable or a plain object.
  const pragma=new SourceText('#pragma warning disable\nclass C { void M() { int a; } }','p.cs'),d=[{...diagnostic(pragma,49,1,'CS0168','m','warning'),warningLevel:3}];
  for(const sources of [new Map([['p.cs',pragma]]),[pragma],{'p.cs':pragma.text},new Map([['p.cs',pragma.text]])])assert.deepEqual(applySuppression(d,{sources}),[]);
  assert.equal(applySuppression(d,{sources:[source]}).length,1);
});
test('A02-T37 SuppressMessage data: spans, targets and compiler diagnostics',()=>{
  const source=new SourceText('class A { void M() { int a; } void N() { int b; } }','a.cs');
  const at=(start,code,severity='warning')=>({...diagnostic(source,start,1,code,'m',severity),warningLevel:1});
  const list=[at(25,'SFX001'),at(45,'SFX001'),at(25,'CS0168'),at(25,'SFX002','error')];
  const run=(suppressions,extra={})=>applySuppression(list,{suppressions,...extra}).map(d=>d.code+'@'+d.start);
  assert.deepEqual(run([{id:'SFX001',uri:'a.cs',span:{start:10,end:29}}]),['SFX001@45','CS0168@25','SFX002@25']);
  assert.deepEqual(run([{id:'SFX001: title'}]),['CS0168@25','SFX002@25']);
  assert.deepEqual(run([{id:'SFX001',scope:'module'}]),['CS0168@25','SFX002@25']);
  assert.deepEqual(run([{id:'sfx001'}]).length,4,'check ids are case-sensitive');
  assert.deepEqual(run([{id:'CS0168'}]).length,4,'compiler diagnostics are not suppressible by attribute');
  assert.deepEqual(run([{id:'SFX002'}]).length,4,'errors are never suppressed');
  // A Target that was not bound to spans needs the binder's resolver; unresolved targets suppress nothing.
  assert.deepEqual(run([{id:'SFX001',scope:'member',target:'~M:A.N'}]).length,4);
  assert.deepEqual(run([{id:'SFX001',scope:'member',target:'~M:A.N'}],{resolveTarget:s=>s.target==='~M:A.N'?[{uri:'a.cs',start:30,end:49}]:[]}),['SFX001@25','CS0168@25','SFX002@25']);
  assert.deepEqual(run([{id:'SFX001',scope:'type',target:'~T:A',spans:[{uri:'b.cs',start:0,end:100}]}]).length,4);
  assert.deepEqual(run([{id:'CS0168'}],{isCompilerDiagnostic:()=>false}),['SFX001@25','SFX001@45','SFX002@25']);
});
