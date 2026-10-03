/**
 * Regenerates the pinned Roslyn expectations in this folder:
 *   roslyn-accessibility.json  accessibility fixtures (CS0122 / CS1540) with their C# sources and Roslyn's verdict per access
 *   roslyn-declarations.json   duplicate-declaration fixtures (CS0101 / CS0102 / CS0111 / CS0260 / CS0262)
 *
 * Usage: node packages/compiler/test/accessibility/generate-roslyn-accessibility.js
 * Needs a .NET SDK (DOTNET_ROOT, default ~/.dotnet); the tests read only the JSON files and never run dotnet.
 *
 * Accessibility fixtures are symbol models (assemblies, types, members, accesses). The C# source is generated from
 * the model, one access per line, so the test can build the same symbol graph by hand and compare `checkAccess`
 * with what Roslyn reported for that line.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const dotnetRoot=process.env.DOTNET_ROOT??join(homedir(),'.dotnet'),dotnet=join(dotnetRoot,'dotnet');
const sdk=readdirSync(join(dotnetRoot,'sdk')).sort().at(-1),csc=join(dotnetRoot,'sdk',sdk,'Roslyn','bincore','csc.dll');
const runtime=readdirSync(join(dotnetRoot,'shared','Microsoft.NETCore.App')).sort().at(-1),runtimeDir=join(dotnetRoot,'shared','Microsoft.NETCore.App',runtime);
const work=process.env.SF_ROSLYN_WORK??mkdtempSync(join(tmpdir(),'sf-roslyn-'));mkdirSync(work,{recursive:true});

/** Runs csc over files and returns the error diagnostics `{file,line,column,code,message}`. */
function compile(name,files,references=[]){
  const out=join(work,name+'.dll'),args=[csc,'-nologo','-t:library','-nowarn:CS0169,CS0414,CS0649,CS0628,CS8618','-r:'+join(runtimeDir,'System.Runtime.dll'),'-r:'+join(runtimeDir,'System.Private.CoreLib.dll'),...references.map(r=>'-r:'+join(work,r+'.dll')),'-out:'+out,...files];
  let output='';try{output=execFileSync(dotnet,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){output=String(error.stdout??'')+String(error.stderr??'');if(!/error CS\d+/.test(output))throw error;}
  const diagnostics=[];for(const line of output.split(/\r?\n/)){const m=/^(.*)\((\d+),(\d+)\): error (CS\d+): (.*)$/.exec(line);if(m)diagnostics.push({file:m[1],line:+m[2],column:+m[3],code:m[4],message:m[5]});}
  return diagnostics;
}

// ---- accessibility fixture models -------------------------------------------------------------------------------
const field=(name,access,isStatic=false)=>({kind:'field',name,access,static:isStatic});
const method=(name,access,isStatic=false)=>({kind:'method',name,access,static:isStatic});
const property=(name,access,isStatic=false)=>({kind:'property',name,access,static:isStatic});
const ctor=access=>({kind:'constructor',name:'.ctor',access,static:false});
const type=(name,options={})=>({name,access:options.access??null,base:options.base??null,members:options.members??[],types:options.types??[]});
const assembly=(name,types,options={})=>({name,types,references:options.references??[],internalsVisibleTo:options.internalsVisibleTo??[]});
/** An access written in type `within`: `target` is 'Type', 'Type.Member' or 'Type..ctor'; `through` is the qualifier type of an instance access. */
const access=(within,target,through=null)=>({within,target,through});
const every=(accessValue,suffix='')=>[field('F'+suffix,accessValue),method('M'+suffix,accessValue),property('P'+suffix,accessValue)];
const lib=(types,internalsVisibleTo=[])=>assembly('Lib',types,{internalsVisibleTo});
const app=types=>assembly('App',types,{references:['Lib']});

const fixtures=[
  {name:'public-members-are-accessible-everywhere',assemblies:[lib([type('A',{access:'public',members:[...every('public'),field('S','public',true),ctor('public')],types:[type('N',{access:'public'})]})]),app([type('X')])],
    accesses:[access('X','A'),access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('X','A..ctor')]},
  {name:'private-members',assemblies:[assembly('App',[type('A',{members:[...every('private'),field('S','private',true),method('Default',null)],types:[type('Inner',{types:[type('Innermost')]})]}),type('B',{base:'A'}),type('X')])],
    accesses:[access('A','A.F','A'),access('A','A.S'),access('A.Inner','A.F','A'),access('A.Inner.Innermost','A.M','A'),access('A.Inner','A.S'),access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.Default','A'),access('B','A.F','A'),access('B','A.F','B'),access('B','A.S')]},
  {name:'private-nested-types',assemblies:[assembly('App',[type('A',{types:[type('Hidden',{access:'private',members:[field('F','public'),field('S','public',true)]}),type('Default',{members:[field('S','public',true)]}),type('Sibling')]}),type('B',{base:'A'}),type('X')])],
    accesses:[access('A','A.Hidden'),access('A.Sibling','A.Hidden'),access('A.Sibling','A.Hidden.S'),access('A.Hidden','A.Default.S'),access('X','A.Hidden'),access('X','A.Default'),access('X','A.Hidden.S'),access('B','A.Hidden'),access('X','A.Sibling')]},
  {name:'private-member-of-nested-type-from-outer',assemblies:[assembly('App',[type('Outer',{members:[field('Secret','private',true)],types:[type('Inner',{access:'public',members:[field('F','private'),field('S','private',true),field('Open','internal')],types:[type('Deep',{access:'public'})]})]})])],
    accesses:[access('Outer','Outer.Inner.F','Outer.Inner'),access('Outer','Outer.Inner.S'),access('Outer','Outer.Inner.Open','Outer.Inner'),access('Outer.Inner.Deep','Outer.Inner.F','Outer.Inner'),access('Outer.Inner.Deep','Outer.Secret')]},
  {name:'internal-same-assembly',assemblies:[assembly('App',[type('A',{access:'internal',members:[...every('internal'),field('S','internal',true),ctor('internal')],types:[type('N',{access:'internal'})]}),type('X')])],
    accesses:[access('X','A'),access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('X','A..ctor')]},
  {name:'internal-other-assembly',assemblies:[lib([type('A',{access:'public',members:[...every('internal'),field('S','internal',true),field('Pub','public',true),ctor('internal')],types:[type('N',{access:'internal'})]}),type('Hidden',{access:'internal',members:[field('S','public',true)]}),type('Default',{members:[field('S','public',true)]})]),app([type('X')])],
    accesses:[access('X','A'),access('X','A.Pub'),access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('X','A..ctor'),access('X','Hidden'),access('X','Default'),access('X','Hidden.S')]},
  {name:'internals-visible-to',assemblies:[lib([type('A',{access:'public',members:[...every('internal'),field('S','internal',true),field('Priv','private',true),ctor('internal')],types:[type('N',{access:'internal'}),type('PN',{access:'private'})]}),type('Hidden',{access:'internal',members:[field('S','public',true),field('I','internal',true)]})],['App']),app([type('X')])],
    accesses:[access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('X','A..ctor'),access('X','Hidden'),access('X','Hidden.S'),access('X','Hidden.I'),access('X','A.Priv'),access('X','A.PN')]},
  {name:'protected-instance-members',assemblies:[assembly('App',[type('A',{members:[...every('protected')]}),type('B',{base:'A'}),type('C',{base:'B'}),type('X')])],
    accesses:[access('A','A.F','A'),access('A','A.F','B'),access('B','A.F','B'),access('B','A.M','B'),access('B','A.P','B'),access('B','A.F','C'),access('B','A.F','A'),access('B','A.M','A'),access('B','A.P','A'),access('C','A.F','B'),access('C','A.F','C'),access('C','A.F','A'),access('X','A.F','A'),access('X','A.M','B'),access('X','A.P','C')]},
  {name:'protected-static-members',assemblies:[assembly('App',[type('A',{members:[field('S','protected',true),method('SM','protected',true),property('SP','protected',true)]}),type('B',{base:'A'}),type('X')])],
    accesses:[access('B','A.S'),access('B','A.SM'),access('B','A.SP'),access('A','A.S'),access('X','A.S'),access('X','A.SM'),access('X','A.SP')]},
  {name:'protected-siblings',assemblies:[assembly('App',[type('A',{members:[field('F','protected'),method('M','protected')]}),type('D1',{base:'A'}),type('D2',{base:'A'})])],
    accesses:[access('D1','A.F','D1'),access('D1','A.F','D2'),access('D1','A.M','D2'),access('D2','A.F','D1'),access('D2','A.M','D2')]},
  {name:'protected-from-nested-types',assemblies:[assembly('App',[type('A',{members:[field('F','protected'),field('S','protected',true)],types:[type('InA')]}),type('B',{base:'A',types:[type('InB',{types:[type('Deep')]})]}),type('X',{types:[type('InX',{base:'A'})]})])],
    accesses:[access('A.InA','A.F','A'),access('A.InA','A.F','B'),access('A.InA','A.S'),access('B.InB','A.F','B'),access('B.InB','A.F','A'),access('B.InB','A.S'),access('B.InB.Deep','A.F','B'),access('B.InB.Deep','A.F','A'),access('X','A.F','X.InX'),access('X','A.S'),access('X.InX','A.F','X.InX'),access('X.InX','A.F','A')]},
  {name:'protected-internal-same-assembly',assemblies:[assembly('App',[type('A',{members:[...every('protected internal'),field('S','protected internal',true)],types:[type('N',{access:'protected internal'})]}),type('B',{base:'A'}),type('X')])],
    accesses:[access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('B','A.F','A'),access('B','A.F','B')]},
  {name:'protected-internal-other-assembly',assemblies:[lib([type('A',{access:'public',members:[...every('protected internal'),field('S','protected internal',true),ctor('protected internal')],types:[type('N',{access:'protected internal'})]})]),app([type('B',{base:'A'}),type('X')])],
    accesses:[access('X','A.F','A'),access('X','A.M','A'),access('X','A.P','A'),access('X','A.S'),access('X','A.N'),access('X','A..ctor'),access('B','A.F','B'),access('B','A.M','B'),access('B','A.F','A'),access('B','A.P','A'),access('B','A.S'),access('B','A.N'),access('B','A..ctor')]},
  {name:'protected-internal-with-internals-visible-to',assemblies:[lib([type('A',{access:'public',members:[...every('protected internal'),field('S','protected internal',true)]})],['App']),app([type('B',{base:'A'}),type('X')])],
    accesses:[access('X','A.F','A'),access('X','A.S'),access('B','A.F','A'),access('B','A.M','B')]},
  {name:'private-protected-same-assembly',assemblies:[assembly('App',[type('A',{members:[...every('private protected'),field('S','private protected',true)],types:[type('N',{access:'private protected'})]}),type('B',{base:'A'}),type('X')])],
    accesses:[access('A','A.F','A'),access('B','A.F','B'),access('B','A.M','B'),access('B','A.P','B'),access('B','A.S'),access('B','A.N'),access('B','A.F','A'),access('X','A.F','A'),access('X','A.M','A'),access('X','A.S'),access('X','A.N')]},
  {name:'private-protected-other-assembly',assemblies:[lib([type('A',{access:'public',members:[...every('private protected'),field('S','private protected',true)],types:[type('N',{access:'private protected'})]})]),app([type('B',{base:'A'}),type('X')])],
    accesses:[access('B','A.F','B'),access('B','A.M','B'),access('B','A.P','B'),access('B','A.S'),access('B','A.N'),access('B','A.F','A'),access('X','A.F','A'),access('X','A.S')]},
  {name:'private-protected-with-internals-visible-to',assemblies:[lib([type('A',{access:'public',members:[...every('private protected'),field('S','private protected',true)]})],['App']),app([type('B',{base:'A'}),type('X')])],
    accesses:[access('B','A.F','B'),access('B','A.M','B'),access('B','A.S'),access('B','A.F','A'),access('X','A.F','A'),access('X','A.S')]},
  {name:'constructors',assemblies:[assembly('App',[type('Pub',{members:[ctor('public')]}),type('Priv',{members:[ctor('private')],types:[type('In')]}),type('Prot',{members:[ctor('protected')],types:[type('In')]}),type('Derived',{base:'Prot',types:[type('In')]}),type('PrivProt',{members:[ctor('private protected')]}),type('Implicit'),type('X')])],
    accesses:[access('X','Pub..ctor'),access('X','Priv..ctor'),access('Priv','Priv..ctor'),access('Priv.In','Priv..ctor'),access('X','Prot..ctor'),access('Prot','Prot..ctor'),access('Prot.In','Prot..ctor'),access('Derived','Prot..ctor'),access('Derived.In','Prot..ctor'),access('Derived','Derived..ctor'),access('X','PrivProt..ctor'),access('X','Implicit..ctor')]},
  {name:'protected-nested-types',assemblies:[assembly('App',[type('A',{types:[type('PN',{access:'protected',members:[field('S','public',true),field('I','internal',true),field('Priv','private',true)]})]}),type('B',{base:'A',types:[type('InB')]}),type('X')])],
    accesses:[access('A','A.PN'),access('B','A.PN'),access('B','A.PN.S'),access('B','A.PN.I'),access('B','A.PN.Priv'),access('B.InB','A.PN.S'),access('X','A.PN'),access('X','A.PN.S')]},
  {name:'member-limited-by-containing-type',assemblies:[lib([type('Pub',{access:'public',types:[type('Int',{access:'internal',members:[field('S','public',true)],types:[type('Deep',{access:'public',members:[field('S','public',true)]})]}),type('Prot',{access:'protected',members:[field('S','public',true)]})]})]),app([type('D',{base:'Pub'}),type('X')])],
    accesses:[access('X','Pub.Int'),access('X','Pub.Int.S'),access('X','Pub.Int.Deep'),access('X','Pub.Int.Deep.S'),access('X','Pub.Prot'),access('X','Pub.Prot.S'),access('D','Pub.Prot'),access('D','Pub.Prot.S'),access('D','Pub.Int.Deep.S')]},
  {name:'default-accessibility',assemblies:[lib([type('Pub',{access:'public',members:[field('F',null),method('M',null),property('P',null),field('S',null,true)],types:[type('N')]}),type('Top',{members:[field('S','public',true)]})],['App']),app([type('X')])],
    accesses:[access('X','Pub.F','Pub'),access('X','Pub.M','Pub'),access('X','Pub.P','Pub'),access('X','Pub.S'),access('X','Pub.N'),access('X','Top'),access('X','Top.S')]},
];

const qualified=(owner,t)=>owner?owner+'.'+t.name:t.name;
function findType(fixture,name){let found=null;const visit=(types,owner,asm)=>{for(const t of types){const q=qualified(owner,t);if(q===name)found={type:t,assembly:asm};visit(t.types,q,asm);}};for(const asm of fixture.assemblies)visit(asm.types,'',asm);if(!found)throw new Error(`${fixture.name}: unknown type ${name}`);return found;}
function findTarget(fixture,target){
  if(target.endsWith('..ctor')){const owner=target.slice(0,-6),t=findType(fixture,owner).type;return {kind:'constructor',owner,member:t.members.find(m=>m.kind==='constructor')??null};}
  try{return {kind:'type',...findType(fixture,target)};}catch{/* a member */}
  const dot=target.lastIndexOf('.'),owner=target.slice(0,dot),member=findType(fixture,owner).type.members.find(m=>m.name===target.slice(dot+1));if(!member)throw new Error(`${fixture.name}: unknown member ${target}`);return {kind:'member',owner,member};
}
function accessLine(fixture,a,id){
  const target=findTarget(fixture,a.target),name=`__a${id}`;
  if(target.kind==='type')return `void ${name}() { _ = typeof(${a.target}); }`;
  if(target.kind==='constructor')return `void ${name}() { _ = new ${target.owner}(); }`;
  const m=target.member;if(!m.static&&!a.through)throw new Error(`${fixture.name}: instance access ${a.target} needs a qualifier type`);if(m.static&&a.through)throw new Error(`${fixture.name}: static access ${a.target} takes no qualifier`);
  const receiver=m.static?target.owner:'q',use=m.kind==='method'?`${receiver}.${m.name}();`:`_ = ${receiver}.${m.name};`;
  return `void ${name}(${m.static?'':a.through+' q'}) { ${use} }`;
}
function emitAssembly(fixture,asm,accesses){
  const lines=[];for(const friend of asm.internalsVisibleTo)lines.push(`[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("${friend}")]`);
  const emit=(t,owner,indent)=>{
    const q=qualified(owner,t),mods=t.access?t.access+' ':'';lines.push(`${indent}${mods}class ${t.name}${t.base?' : '+t.base:''}`,`${indent}{`);
    for(const m of t.members){const prefix=`${indent}    ${m.access?m.access+' ':''}${m.static?'static ':''}`;lines.push(m.kind==='field'?`${prefix}int ${m.name};`:m.kind==='method'?`${prefix}void ${m.name}() { }`:m.kind==='property'?`${prefix}int ${m.name} { get; set; }`:`${prefix}${t.name}() { }`);}
    for(const n of t.types)emit(n,q,indent+'    ');
    for(const a of accesses)if(a.within===q){lines.push(`${indent}    ${accessLine(fixture,a,a.id)}`);a.line=lines.length;a.assembly=asm.name;}
    lines.push(`${indent}}`);
  };
  for(const t of asm.types)emit(t,'','');
  return lines.join('\n')+'\n';
}
// Roslyn does not import internal and private members of a referenced assembly that grants no InternalsVisibleTo, so an
// access to one is reported as a missing member/type instead of CS0122. These codes are pinned as Roslyn reported them.
// CS0281 is what Roslyn 5.x reports (instead of CS0122) for an inaccessible non-private member of an assembly that names the
// accessing assembly in InternalsVisibleTo.
const notImported=['CS1061','CS0117','CS0246','CS0426','CS1729','CS0281'];
function runAccessibility(){
  const result=[];
  for(const fixture of fixtures){
    const accesses=fixture.accesses.map((a,i)=>({id:i+1,...a})),sources={},dir=join(work,fixture.name);mkdirSync(dir,{recursive:true});
    for(const asm of fixture.assemblies){
      const text=emitAssembly(fixture,asm,accesses),file=join(dir,asm.name+'.cs');sources[asm.name]=text;writeFileSync(file,text);
      const diagnostics=compile(join(fixture.name,asm.name),[file],asm.references.map(r=>join(fixture.name,r)));
      for(const d of diagnostics){
        const a=accesses.find(x=>x.assembly===asm.name&&x.line===d.line);
        if(!a||!(['CS0122','CS1540'].includes(d.code)||asm.references.length&&notImported.includes(d.code))||a.code)throw new Error(`${fixture.name}/${asm.name}.cs(${d.line}): unexpected ${d.code}: ${d.message}\n${text}`);
        a.code=d.code;a.message=d.message;
      }
      if(fixture.assemblies.some(other=>other.references.includes(asm.name))&&!existsSync(join(dir,asm.name+'.dll')))throw new Error(`${fixture.name}: referenced assembly ${asm.name} did not compile`);
    }
    for(const a of accesses){if(!a.line)throw new Error(`${fixture.name}: access ${a.id} was not emitted`);a.code??=null;a.message??=null;}
    result.push({name:fixture.name,assemblies:fixture.assemblies,sources,accesses});
  }
  return result;
}

// ---- duplicate declaration fixtures (sources the SharpForge parser accepts) ---------------------------------------
const declarationFixtures=[
  {name:'duplicate-type-in-global-namespace',files:['class A { int x; }\nclass A { int x; void M() { } }\n']},
  {name:'duplicate-type-in-namespace',files:['namespace X.Y { class A { } class A { } }\nnamespace X { namespace Y { class Z { } } }\nnamespace X.Y { class Z { } }\nnamespace X { class Z { } }\n']},
  {name:'duplicate-type-across-files',files:['namespace App { class A { } }\n','namespace App { class A { } }\nclass A { }\n']},
  {name:'missing-partial',files:['partial class B { }\nclass B { }\nclass C0 { }\npartial class C0 { }\npartial class C0 { }\n']},
  {name:'partial-accessibility-conflict',files:['public partial class D { }\n','internal partial class D { }\npartial class D { }\npublic partial class E { }\npartial class E { }\npublic partial class E { }\n']},
  {name:'partial-merge-reports-member-duplicates',files:['partial class P { int a; void M(int x) { } }\n','partial class P { int a; void M(int y) { } void M(string y) { } }\n']},
  {name:'duplicate-fields-and-properties',files:['class E {\n  int f;\n  int f;\n  void f() { }\n  int P { get; set; }\n  int P { get; set; }\n  string P;\n  void Q() { }\n  int Q { get; set; }\n  void R() { }\n  void R(int a) { }\n  int R;\n}\n']},
  {name:'duplicate-methods',files:['class E {\n  void G(int a) { }\n  void G(int b) { }\n  void H(int a) { }\n  int H(int a) { return 0; }\n  void H(string a) { }\n  void H(int a, string b) { }\n  void H(int c, string d) { }\n  static void S() { }\n  void S() { }\n  void T(int[] a) { }\n  void T(int[] b) { }\n  void T(int a) { }\n}\n']},
  {name:'duplicate-constructors',files:['class E {\n  E() { }\n  E() { }\n  E(int a) { }\n  public E(int b) { }\n  E(string a) { }\n}\nnamespace N { class G { G(int a) { } G(int a) { } void M() { } void M() { } int v; int v; } }\n']},
  {name:'no-duplicates',files:['partial class A { int x; void M() { } }\npartial class A { int y; void M(int a) { } A() { } A(int a) { } }\nnamespace N { class A { int x; } }\nnamespace M { class A { int x; } }\n']},
];
function runDeclarations(){
  const codes=['CS0101','CS0102','CS0111','CS0260','CS0262'],result=[];
  for(const fixture of declarationFixtures){
    const dir=join(work,'decl-'+fixture.name);mkdirSync(dir,{recursive:true});const files=fixture.files.map((text,i)=>{const file=join(dir,`file${i}.cs`);writeFileSync(file,text);return file;});
    const diagnostics=compile('decl-'+fixture.name,files).map(d=>({file:files.indexOf(d.file),line:d.line,column:d.column,code:d.code,message:d.message}));
    const unexpected=diagnostics.filter(d=>!codes.includes(d.code)||d.file<0);if(unexpected.length)throw new Error(`${fixture.name}: unexpected ${JSON.stringify(unexpected)}`);
    diagnostics.sort((a,b)=>a.file-b.file||a.line-b.line||a.column-b.column||a.code.localeCompare(b.code));result.push({name:fixture.name,files:fixture.files,diagnostics});
  }
  return result;
}
const header={generator:'packages/compiler/test/accessibility/generate-roslyn-accessibility.js',sdk,runtime};
const accessibility=runAccessibility(),declarations=runDeclarations();
writeFileSync(join(here,'roslyn-accessibility.json'),JSON.stringify({...header,fixtures:accessibility},null,1)+'\n');
writeFileSync(join(here,'roslyn-declarations.json'),JSON.stringify({...header,fixtures:declarations},null,1)+'\n');
const total=accessibility.reduce((n,f)=>n+f.accesses.length,0),flagged=accessibility.reduce((n,f)=>n+f.accesses.filter(a=>a.code).length,0);
console.log(`Roslyn ${sdk}: ${accessibility.length} accessibility fixtures, ${total} accesses (${flagged} errors); ${declarations.length} declaration fixtures, ${declarations.reduce((n,f)=>n+f.diagnostics.length,0)} diagnostics`);
