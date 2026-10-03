import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CompilationOptions,parseCompilationOptions,fromMSBuildProperties,toMSBuildProperties,parseLanguageVersion,outputKinds,msbuildPropertyNames} from '../packages/compiler/src/options.js';
import {languageVersion} from '../packages/compiler/src/modern.js';

const dump=JSON.parse(readFileSync(new URL('../packages/compiler/test/roslyn/diagnostic-messages.json',import.meta.url),'utf8')).codes;
const codes=result=>result.diagnostics.map(d=>d.code);
const parse=(raw,settings)=>parseCompilationOptions(raw,settings);

test('A02-T38 defaults and immutability',()=>{
  const {options,diagnostics}=parse();
  assert.deepEqual(diagnostics,[]);
  assert.deepEqual(options.toJSON(),{outputKind:'exe',checkOverflow:false,allowUnsafe:false,nullableContext:'disable',optimizationLevel:'debug',deterministic:false,preprocessorSymbols:[],warningLevel:4,noWarn:[],warnAsError:[],warnNotAsError:[],treatWarningsAsErrors:false});
  assert.equal(options.name,null);assert.equal(options.mainTypeName,null);assert.equal(options.langVersion,null);
  assert(options.equals(CompilationOptions.default));assert(Object.isFrozen(options));assert(Object.isFrozen(options.preprocessorSymbols));
  assert.throws(()=>{'use strict';options.outputKind='library';},TypeError);
  assert.throws(()=>options.noWarn.push('CS0168'),TypeError);
  assert.equal(parse(options).options,options,'a CompilationOptions passes through unchanged');
});
test('A02-T38 with() derives validated copies',()=>{
  const base=parse({outputKind:'library',preprocessorSymbols:['DEBUG'],langVersion:'12'}).options;
  const next=base.with({checkOverflow:true,preprocessorSymbols:'DEBUG;TRACE',noWarn:[168]});
  assert.equal(base.checkOverflow,false);assert.deepEqual(base.preprocessorSymbols,['DEBUG']);
  assert.equal(next.outputKind,'library');assert.equal(next.checkOverflow,true);assert.deepEqual(next.preprocessorSymbols,['DEBUG','TRACE']);assert.deepEqual(next.noWarn,['CS0168']);assert.equal(next.langVersion,'12');
  assert(next.isDefined('TRACE'));assert(!next.isDefined('X'));assert(next.isLibrary);assert(!next.with({outputKind:'exe'}).isLibrary);
  assert.equal(next.with({langVersion:null}).langVersion,null);
  assert(base.with({}).equals(base));assert(!next.equals(base));
  assert.throws(()=>base.with({outputKind:'dll'}),/CS2019/);
  assert.throws(()=>base.with({mainTypeName:'App.Program'}),/CS2017/);
  assert.throws(()=>base.with({checkOverflow:'true'}),/SF2009/);
});
test('A02-T38 accepts everything the compiler accepts today',()=>{
  const raw={outputKind:'library',checkOverflow:true,checkOverflowByUri:{'a.cs':false},langVersion:'preview',langVersionByUri:{'a.cs':'12','b.cs':'Latest','c.cs':14,'d.cs':'9.0'},name:'App',debug:true,somethingElse:1};
  const {options,diagnostics}=parse(raw);
  assert.deepEqual(diagnostics,[]);
  assert.equal(options.outputKind,'library');assert.equal(options.name,'App');assert.equal(options.checkOverflow,true);
  assert.equal(options.checkOverflowFor('a.cs'),false);assert.equal(options.checkOverflowFor('z.cs'),true);
  assert.equal(options.langVersionFor('a.cs'),'12');assert.equal(options.langVersionFor('b.cs'),'latest');assert.equal(options.langVersionFor('c.cs'),'14');assert.equal(options.langVersionFor('z.cs'),'preview');
  assert.equal(options.somethingElse,undefined);
  // Every language version the profile's own languageVersion() accepts is accepted here with the same number, and vice versa.
  for(const value of ['1','2','3','4','5','6','7','7.1','7.2','7.3','iso-1','ISO-2','8','9','10','11','12','13','14','14.0','7.0','default','latest','latestmajor','preview','PREVIEW',12]){
    const r=parse({langVersion:value});assert.deepEqual(r.diagnostics,[],String(value));
    const mine=parseLanguageVersion(value),theirs=languageVersion(r.options.langVersion);
    assert.equal(mine.number,theirs.number,String(value));assert.equal(mine.preview,theirs.preview,String(value));
  }
  for(const value of ['15','0','14.1','x','1.5',''])assert.throws(()=>languageVersion(value===''?' ':value),undefined,value);
  for(const value of [true,false])assert.deepEqual(parse({checkOverflow:value}).diagnostics,[]);
});
test('A02-T38 invalid options report the Roslyn codes',()=>{
  const cases=[
    [{outputKind:'dll'},'CS2019',[]],[{outputKind:'Library'},'CS2019',[]],[{outputKind:7},'CS2019',[]],
    [{langVersion:'15'},'CS1617',['15']],[{langVersion:'bogus'},'CS1617',['bogus']],[{langVersion:'7.4'},'CS1617',['7.4']],[{langVersion:'0'},'CS1617',['0']],[{langVersion:true},'CS1617',['true']],
    [{langVersionByUri:{'a.cs':'99'}},'CS1617',['99']],
    [{nullableContext:'on'},'CS8636',['on']],[{nullable:'true'},'CS8636',['true']],[{nullableContext:true},'CS8636',['true']],
    [{nullableContext:'enable',langVersion:'7'},'CS8630',['nullable','Enable','7.0','8.0']],[{nullableContext:'Warnings',langVersion:'6'},'CS8630',['nullable','Warnings','6','8.0']],
    [{warningLevel:-1},'CS1900',[]],[{warningLevel:1.5},'CS1900',[]],[{warningLevel:'high'},'CS1900',[]],
    [{preprocessorSymbols:'DEBUG;1BAD;A-B'},'CS2029',['1BAD']],
    [{mainTypeName:'P',outputKind:'library'},'CS2017',[]],[{mainTypeName:''},'CS7088',['MainTypeName','']],
    [{name:''},'CS8203',['']],[{name:'a/b'},'CS8203',['a/b']],[{name:' lead'},'CS8203',[' lead']],
    [{allowUnsafe:'yes'},'CS7088',['AllowUnsafe','yes']],[{deterministic:1},'CS7088',['Deterministic','1']],[{treatWarningsAsErrors:'true'},'CS7088',['TreatWarningsAsErrors','true']],
    [{optimizationLevel:'fast'},'CS7088',['OptimizationLevel','fast']],[{optimize:'true'},'CS7088',['OptimizationLevel','true']]
  ];
  for(const [raw,code,args] of cases){
    const r=parse(raw);assert.equal(r.diagnostics[0]?.code,code,JSON.stringify(raw));assert.deepEqual(r.diagnostics[0].args,args,JSON.stringify(raw));
    // Every reported code is a real Roslyn diagnostic and the argument count fits its pinned message format.
    const format=dump[code][3],placeholders=new Set([...format.matchAll(/\{(\d+)/g)].map(m=>m[1])).size;
    assert.equal(args.length,placeholders,`${code}: ${format}`);
    assert(r.options instanceof CompilationOptions,'options stay usable after an invalid value');
  }
  assert.deepEqual(parse({preprocessorSymbols:'DEBUG;1BAD;A-B'}).options.preprocessorSymbols,['DEBUG']);
  assert.equal(dump.CS2029[1],'warning');
  assert.deepEqual(codes(parse({preprocessorSymbols:['A B','','ok','ok','_x','é1']})),['CS2029']);
  assert.deepEqual(parse({preprocessorSymbols:['ok','ok','_x','é1']}).options.preprocessorSymbols,['ok','_x','é1']);
  assert.equal(parse({outputKind:'dll'}).options.outputKind,'exe');assert.equal(parse({warningLevel:-1}).options.warningLevel,4);
  assert.deepEqual(codes(parse({outputKind:'dll',langVersion:'x',nullableContext:'q',warningLevel:-3})),['CS2019','CS1617','CS8636','CS1900']);
  // Valid forms next to the invalid ones.
  for(const raw of [{nullableContext:'Enable',langVersion:'8'},{nullable:'annotations'},{nullableContext:'disable',langVersion:'5'},{nullableContext:'enable'},{warningLevel:0},{warningLevel:'9999'},{mainTypeName:'App.Program'},{optimize:true},{optimizationLevel:'Release'},{warnAsError:true}])assert.deepEqual(parse(raw).diagnostics,[],JSON.stringify(raw));
  assert.equal(parse({optimize:true}).options.optimizationLevel,'release');assert.equal(parse({warnAsError:true}).options.treatWarningsAsErrors,true);assert.equal(parse({nullable:'Annotations'}).options.nullableContext,'annotations');
  assert.deepEqual(parse({noWarn:'168;CS0219, 0078',warnAsError:[612,'IDE0051'],warnNotAsError:'618'}).options.toJSON().noWarn,['CS0168','CS0219','CS0078']);
});
test('A02-T38 SharpForge codes: API typing and profile restrictions',()=>{
  for(const value of ['true',1,0,'false',{}]){const r=parse({checkOverflow:value});assert.deepEqual(r.diagnostics,[{code:'SF2009',args:['checkOverflow']}]);assert.equal(r.options.checkOverflow,false);}
  assert.deepEqual(parse({checkOverflowByUri:{'a.cs':'true'}}).diagnostics,[{code:'SF2009',args:['checkOverflow']}]);
  assert.deepEqual(parse({checkOverflow:1,checkOverflowByUri:{'a.cs':1}}).diagnostics,[{code:'SF2009',args:['checkOverflow']}]);
  // Roslyn accepts these; the execution profile does not (profile:false validates against Roslyn alone).
  for(const kind of outputKinds.filter(k=>k!=='exe'&&k!=='library')){
    assert.deepEqual(parse({outputKind:kind}).diagnostics,[{code:'SF2008',args:[kind]}]);
    const roslyn=parse({outputKind:kind},{profile:false});assert.deepEqual(roslyn.diagnostics,[]);assert.equal(roslyn.options.outputKind,kind);
  }
  for(const version of ['7.1','7.2','7.3','ISO-1','iso-2']){
    assert.deepEqual(parse({langVersion:version}).diagnostics,[]);
    const roslyn=parse({langVersion:version},{profile:false});assert.deepEqual(roslyn.diagnostics,[]);assert.equal(roslyn.options.langVersion,version.toLowerCase());
  }
  assert.deepEqual(parse({mainTypeName:'P',outputKind:'module'},{profile:false}).diagnostics,[{code:'CS2017',args:[]}]);
  assert.deepEqual(parse({nullableContext:'enable',langVersion:'7.3'},{profile:false}).diagnostics,[{code:'CS8630',args:['nullable','Enable','7.3','8.0']}]);
  assert.deepEqual([parseLanguageVersion('7.3').number,parseLanguageVersion('iso-2').number,parseLanguageVersion('LatestMajor').number,parseLanguageVersion('preview').preview,parseLanguageVersion('7.5')],[7.3,2,14,true,null]);
});
test('A02-T38 options round-trip through MSBuild property names',()=>{
  const props={OutputType:'Library',CheckForOverflowUnderflow:'true',AllowUnsafeBlocks:'True',Nullable:'enable',Optimize:'true',Deterministic:'true',DefineConstants:'DEBUG;TRACE;NET10_0',LangVersion:'12.0',WarningLevel:'5',NoWarn:'1591;CS0168',WarningsAsErrors:'CS8600;nullable',WarningsNotAsErrors:'CS0618',TreatWarningsAsErrors:'true',AssemblyName:'My.App'};
  const {options,diagnostics}=fromMSBuildProperties(props);
  assert.deepEqual(diagnostics,[]);
  assert.deepEqual(options.toJSON(),{name:'My.App',outputKind:'library',checkOverflow:true,allowUnsafe:true,nullableContext:'enable',optimizationLevel:'release',deterministic:true,preprocessorSymbols:['DEBUG','TRACE','NET10_0'],langVersion:'12.0',warningLevel:5,noWarn:['CS1591','CS0168'],warnAsError:['CS8600','nullable'],warnNotAsError:['CS0618'],treatWarningsAsErrors:true});
  const written=toMSBuildProperties(options);
  assert.deepEqual(written,{AssemblyName:'My.App',OutputType:'Library',CheckForOverflowUnderflow:'true',AllowUnsafeBlocks:'true',Nullable:'enable',Optimize:'true',Deterministic:'true',DefineConstants:'DEBUG;TRACE;NET10_0',LangVersion:'12.0',WarningLevel:'5',NoWarn:'CS1591;CS0168',WarningsAsErrors:'CS8600;nullable',WarningsNotAsErrors:'CS0618',TreatWarningsAsErrors:'true'});
  for(const name of Object.keys(written))assert(msbuildPropertyNames.includes(name),name);
  assert(fromMSBuildProperties(written).options.equals(options));
  assert.deepEqual(toMSBuildProperties(fromMSBuildProperties(written).options),written);
  // Exe with a startup object; every option kind survives options -> properties -> options.
  const samples=[{},{outputKind:'exe',mainTypeName:'App.Program',name:'App'},{checkOverflow:true,allowUnsafe:true,deterministic:true,optimizationLevel:'release'},{nullableContext:'annotations',langVersion:'preview'},{preprocessorSymbols:['A','B'],warningLevel:0,noWarn:[168],warnAsError:['CS0219'],warnNotAsError:[612],treatWarningsAsErrors:true},{nullableContext:'warnings',langVersion:'latest'}];
  for(const raw of samples){const o=parse(raw).options,back=fromMSBuildProperties(toMSBuildProperties(o));assert.deepEqual(back.diagnostics,[]);assert(back.options.equals(o),JSON.stringify(raw));}
  for(const kind of outputKinds){const o=parse({outputKind:kind},{profile:false}).options;assert(fromMSBuildProperties(toMSBuildProperties(o),{profile:false}).options.equals(o),kind);}
  assert.deepEqual(toMSBuildProperties({outputKind:'library'}).OutputType,'Library');
  // Names are case-insensitive (the project system lower-cases them), empty values are unset.
  const lower=fromMSBuildProperties({outputtype:'winexe',checkforoverflowunderflow:'FALSE',langversion:'',definecontants:'X',defineconstants:' A ; B ,C ',startupobject:'P'},{profile:false});
  assert.deepEqual(lower.diagnostics,[]);assert.equal(lower.options.outputKind,'winexe');assert.equal(lower.options.langVersion,null);assert.deepEqual(lower.options.preprocessorSymbols,['A','B','C']);assert.equal(lower.options.mainTypeName,'P');
  assert(fromMSBuildProperties({}).options.equals(CompilationOptions.default));
});
test('A02-T38 invalid MSBuild properties report the Roslyn codes',()=>{
  const cases=[
    [{OutputType:'Dll'},'CS2019',[]],[{LangVersion:'99'},'CS1617',['99']],[{Nullable:'yes'},'CS8636',['yes']],[{Nullable:'enable',LangVersion:'7'},'CS8630',['nullable','Enable','7.0','8.0']],
    [{WarningLevel:'-2'},'CS1900',[]],[{DefineConstants:'OK;9X'},'CS2029',['9X']],[{OutputType:'Library',StartupObject:'P'},'CS2017',[]],[{AssemblyName:'a:b'},'CS8203',['a:b']],
    [{CheckForOverflowUnderflow:'maybe'},'CS2007',['/checked:maybe']],[{AllowUnsafeBlocks:'1'},'CS2007',['/unsafe:1']],[{Optimize:'yes'},'CS2007',['/optimize:yes']],[{Deterministic:'x'},'CS2007',['/deterministic:x']],[{TreatWarningsAsErrors:'all'},'CS2007',['/warnaserror:all']]
  ];
  for(const [props,code,args] of cases){const r=fromMSBuildProperties(props);assert.deepEqual(r.diagnostics,[{code,args}],JSON.stringify(props));assert(dump[code],code);}
  assert.equal(fromMSBuildProperties({CheckForOverflowUnderflow:'maybe'}).options.checkOverflow,false);
});
