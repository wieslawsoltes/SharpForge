import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compile} from '@sharpforge/compiler';
import {diagnosticDescriptor,formatMessage,argumentCount,diagnosticCodes,profileCodes,defaultSeverity,roslynEquivalent,featureNotAvailableCode,hasDiagnosticCode} from '../packages/compiler/src/diagnostics/codes.js';
import {roslynCodes,ROSLYN_VERSION} from '../packages/compiler/src/diagnostics/roslyn-codes.js';
const pkg=fileURLToPath(new URL('../packages/compiler/',import.meta.url)),root=join(pkg,'src');
const pinned=JSON.parse(readFileSync(join(pkg,'test/roslyn/diagnostic-messages.json'),'utf8'));
const sources=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(dir,e.name)):e.name.endsWith('.js')?[join(dir,e.name)]:[]);
// Keep the existing message/arity assertions effective while callers move from literal ids to catalog constants.
const files=sources(root).filter(f=>!f.endsWith('roslyn-codes.js')).map(f=>[
  f,readFileSync(f,'utf8').replace(/\bDiagnosticId\.((?:CS|SF)\d{4})\b/g,"'$1'")
]);
test('A02-T36 every catalog message format matches the pinned Roslyn resource dump',()=>{
  assert.equal(ROSLYN_VERSION,pinned.roslyn);assert(Object.keys(roslynCodes).length>300);
  for(const [code,row] of Object.entries(roslynCodes)){assert.deepEqual(row,pinned.codes[code],code);const d=diagnosticDescriptor(code);
    assert.equal(d.format,pinned.codes[code][3]);assert.equal(d.severity,pinned.codes[code][1]);assert.equal(d.warningLevel,pinned.codes[code][2]);assert.equal(d.name,pinned.codes[code][0]);assert.equal(d.argumentCount,argumentCount(d.format));}
});
test('A02-T36 the generated descriptor table is up to date',()=>{
  const r=spawnSync(process.execPath,[join(pkg,'scripts/generate-diagnostic-codes.js'),'--check'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('A02-T36 every diagnostic id used by a compiler module is in the catalog',()=>{
  for(const [file,text] of files)for(const m of text.matchAll(/'((?:CS|SF[23])\d{4})'/g))assert(hasDiagnosticCode(m[1]),`${file}: ${m[1]}`);
});
test('A02-T36 no compiler module passes a literal message string',()=>{
  for(const [file,text] of files){
    assert(!/report\([^;]*?'(?:CS|SF)\d{4}',\s*['"`]/.test(text),file+' passes literal message text to report()');
    for(const m of text.matchAll(/\bdiagnostic\(([^;]*?)\);/g))assert(!/'(?:CS|SF)\d{4}',\s*['"`]/.test(m[1]),file+' builds a diagnostic from literal text');
    assert(!/new ConstantError\([^)]*,\s*['"`][A-Z][a-z]/.test(text),file);
  }
});
// Splits the top-level elements of the array literal that starts at text[index]==='['.
function arrayElements(text,index){let depth=0,quote=null,count=0,seen=false;for(let i=index;i<text.length;i++){const c=text[i];
  if(quote){if(c==='\\')i++;else if(c===quote)quote=null;continue;}
  if(c==="'"||c==='"'||c==='`'){quote=c;seen=true;continue;}
  if('([{'.includes(c)){depth++;if(depth>1)seen=true;continue;}
  if(')]}'.includes(c)){depth--;if(depth===0)return seen?count+1:0;continue;}
  if(c===','&&depth===1){count++;continue;}if(!/\s/.test(c))seen=true;}
  return -1;}
test('A02-T36 report() call sites pass as many arguments as the message format consumes',()=>{
  let checked=0;
  for(const [file,text] of files)for(const m of text.matchAll(/report\([^;'`]*?,'((?:CS|SF)\d{4})'(,\[|\)|,[^\[])/g)){
    if(m[2]!==',['&&m[2]!==')')continue; // arguments computed elsewhere: checked at run time by the callers' tests
    const d=diagnosticDescriptor(m[1]),supplied=m[2]===',['?arrayElements(text,m.index+m[0].length-1):0;checked++;
    assert.equal(supplied,d.argumentCount,`${file}: ${m[1]} supplies ${supplied} of ${d.argumentCount} arguments near '${text.slice(m.index,m.index+90)}'`);
  }
  assert(checked>100,'expected to check the compiler call sites, saw '+checked);
});
test('A02-T36 every SF2xxx/SF3xxx code maps to a Roslyn code or is a profile restriction',()=>{
  const used=new Set(files.flatMap(([,text])=>[...text.matchAll(/'(SF[23]\d{3})'/g)].map(m=>m[1])));
  for(const code of used)assert(Object.hasOwn(profileCodes,code),code);
  for(const [code,d] of Object.entries(profileCodes)){assert(d.profileRestriction!==(d.roslyn!==null),code);if(d.roslyn)assert(pinned.codes[d.roslyn],code+' maps to unknown '+d.roslyn);assert.equal(roslynEquivalent(code),d.roslyn);}
  assert.equal(roslynEquivalent('SF2005'),'CS0021');assert.equal(roslynEquivalent('SF2140'),'CS1617');assert.equal(diagnosticDescriptor('SF2001').profileRestriction,true);assert.equal(roslynEquivalent('CS0029'),'CS0029');
});
test('A02-T36 descriptors expose severity, warning level, format and argument count',()=>{
  assert.deepEqual(diagnosticDescriptor('CS0029'),{id:'CS0029',name:'ERR_NoImplicitConv',severity:'error',warningLevel:0,format:"Cannot implicitly convert type '{0}' to '{1}'",argumentCount:2,roslyn:'CS0029',profileRestriction:false});
  assert.equal(diagnosticDescriptor('CS0168').severity,'warning');assert.equal(diagnosticDescriptor('CS0168').warningLevel,3);assert.equal(diagnosticDescriptor('CS0162').warningLevel,2);
  assert.equal(defaultSeverity('CS0219'),'warning');assert.equal(defaultSeverity('CS0103'),'error');assert.equal(diagnosticDescriptor('CS9999'),null);
  assert.equal(formatMessage('CS0029',['string','int']),"Cannot implicitly convert type 'string' to 'int'");
  assert.equal(formatMessage('CS1061',['int','Foo']),"'int' does not contain a definition for 'Foo' and no accessible extension method 'Foo' accepting a first argument of type 'int' could be found (are you missing a using directive or an assembly reference?)");
  assert.throws(()=>formatMessage('CS9999'),RangeError);assert.equal(argumentCount('{0} {2} {0}'),3);assert.equal(argumentCount('none'),0);
  assert(diagnosticCodes().includes('CS0165')&&diagnosticCodes().includes('SF3001'));
});
test('A02-T36 feature gates report the Roslyn code for the selected language version',()=>{
  assert.equal(featureNotAvailableCode(7.3),'CS8370');assert.equal(featureNotAvailableCode(8),'CS8400');assert.equal(featureNotAvailableCode(11),'CS9058');
  const d=compile('class C{static void Main(){C c=new();Console.WriteLine(c);}}',{langVersion:'8'}).diagnostics;
  assert.deepEqual(d.map(x=>[x.code,x.message]),[['CS8400',"Feature 'target-typed object creation' is not available in C# 8.0. Please use language version 9.0 or greater."]]);
  assert.equal(compile('int[] a=[1];',{langVersion:'11'}).diagnostics[0].code,'CS9058');
});
test('A02-T36 compiler diagnostics carry Roslyn message text',()=>{
  const messages=source=>compile(source).diagnostics.map(d=>`${d.code}: ${d.message}`);
  assert.deepEqual(messages('int x="a";'),["CS0029: Cannot implicitly convert type 'string' to 'int'"]);
  assert.deepEqual(messages('Console.WriteLine(y);'),["CS0103: The name 'y' does not exist in the current context"]);
  assert.deepEqual(messages('Foo f=null;'),["CS0246: The type or namespace name 'Foo' could not be found (are you missing a using directive or an assembly reference?)"]);
  // Roslyn 5.3.0 reports the duplicate once and each of the two unused fields (warning CS0169), in source order.
  assert.deepEqual(messages('Console.WriteLine(1); class C{int X;int X;}'),["CS0169: The field 'C.X' is never used","CS0102: The type 'C' already contains a definition for 'X'","CS0169: The field 'C.X' is never used"]);
  assert.deepEqual(compile('Console.WriteLine(1); class C{int X;int X;}').diagnostics.map(d=>[d.severity,d.start,d.length]),[['warning',34,1],['error',40,1],['warning',40,1]]);
  const w=compile('int x=1;Console.WriteLine(x switch{1=>2});').diagnostics.find(d=>d.code==='CS8509');assert.equal(w.severity,'warning');
});
