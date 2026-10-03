import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindReferences,ReferenceManager,resolveAssemblyReference,unificationDiagnostic,AssemblyIdentity,AssemblyIdentityParts,IdentityComparison,compareAssemblyIdentity,referenceMatchesDefinition,publicKeyToken,GlobalAlias} from '../packages/compiler/src/metadata-import/reference-manager.js';
import {sha1} from '../packages/compiler/src/metadata-import/assembly-identity.js';
import {importAssembly} from '../packages/compiler/src/metadata-import/pe-symbols.js';
import {ErrorTypeSymbol,SymbolDisplayFormat,SymbolKind} from '../packages/compiler/src/symbols/types.js';
import {NamespaceSymbol,mergeGlobalNamespaces} from '../packages/compiler/src/symbols/namespaces.js';
import {diagnosticDescriptor,formatMessage,defaultSeverity} from '../packages/compiler/src/diagnostics/codes.js';

// Real assemblies built by csc (tests/fixtures/metadata/build-fixtures.mjs): one core library, three versions of a
// strongly named library, consumers compiled against the lowest and highest version, a weakly named pair and forwarders.
const bytes=name=>new Uint8Array(readFileSync(new URL('./fixtures/metadata/'+name,import.meta.url)));
const reference=(name,aliases)=>({bytes:bytes(name),display:name,...(aliases?{aliases}:{})});
const bind=(names,options)=>bindReferences(names.map(n=>Array.isArray(n)?reference(n[0],n[1]):reference(n)),options);
const T=SymbolDisplayFormat.Test,show=s=>s.toDisplayString(T);
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const Core='MiniStandard.dll',V1='VersionedLib.1.0.0.0.dll',V105='VersionedLib.1.0.0.5.dll',V2='VersionedLib.2.0.0.0.dll';
const token=importAssembly(bytes(Core)).identity.publicKeyToken,lib=version=>`VersionedLib, Version=${version}, Culture=neutral, PublicKeyToken=${token}`;

test('A02-T22 assembly identities parse, display and compare like Roslyn',()=>{
  const id=AssemblyIdentity.parse('System.Runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=B03F5F7F11D50A3A');
  assert.deepEqual([id.name,id.version,id.cultureName,id.publicKeyToken,id.isStrongName,id.isRetargetable],['System.Runtime',[8,0,0,0],'','b03f5f7f11d50a3a',true,false]);
  assert.equal(id.getDisplayName(),'System.Runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a');assert.equal(String(new AssemblyIdentity({name:'App'})),'App, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null');
  assert.equal(new AssemblyIdentity({name:'R',version:'1.2.3.4',cultureName:'de-DE',publicKeyToken:'0123456789abcdef',isRetargetable:true}).getDisplayName(),'R, Version=1.2.3.4, Culture=de-DE, PublicKeyToken=0123456789abcdef, Retargetable=Yes');
  assert.equal(new AssemblyIdentity({name:'a,b'}).getDisplayName(),'a\\,b, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null');assert.equal(AssemblyIdentity.parse('a\\,b, Version=1.0.0.0').name,'a,b');
  const partial=AssemblyIdentity.tryParse('Lib, Version=1.2');assert.deepEqual(partial.identity.version,[1,2,0,0]);assert.equal(partial.parts&AssemblyIdentityParts.Version,0,'a partial version is not a full Version part');
  for(const bad of ['',', Version=1.0.0.0','Lib, Version=1.0.0.70000','Lib, Version=x','Lib, PublicKeyToken=123','Lib, Culture=neutral, Culture=en','Lib, Retargetable=Yes','Lib, Version'])assert.equal(AssemblyIdentity.tryParse(bad),null,bad);
  assert.throws(()=>AssemblyIdentity.parse('Lib, Version=bad'),RangeError);assert.throws(()=>new AssemblyIdentity({}),RangeError);
  assert.ok(id.equals(AssemblyIdentity.parse('system.runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a')),'simple names compare case-insensitively');assert.ok(!id.equals(id.withVersion('9.0.0.0')));
  // The token is the last eight bytes of the SHA-1 of the public key, reversed (ECMA-335 II.6.2.1.3).
  assert.equal(hex(sha1(new TextEncoder().encode('abc'))),'a9993e364706816aba3e25717850c26c9cd0d89d');
  const ecma=Uint8Array.from([0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0]);assert.equal(publicKeyToken(ecma),'b77a5c561934e089');assert.equal(new AssemblyIdentity({name:'mscorlib',publicKey:ecma}).publicKeyToken,'b77a5c561934e089');
  const core=importAssembly(bytes(Core)).identity;assert.equal(core.hasPublicKey,true);assert.equal(core.publicKeyToken,publicKeyToken(Uint8Array.from(core.publicKey.match(/../g),h=>parseInt(h,16))));
  assert.equal(importAssembly(bytes(V1)).referencedAssemblyIdentities[0].publicKeyToken,core.publicKeyToken,'an AssemblyRef stores the token the definition key hashes to');
  // comparison
  const strong=v=>AssemblyIdentity.parse(lib(v)),weak=v=>new AssemblyIdentity({name:'WeakLib',version:v}),result=(a,b,o)=>compareAssemblyIdentity(a,b,o).result;
  assert.equal(result(strong('1.0.0.0'),strong('1.0.0.0')),IdentityComparison.Equivalent);assert.equal(result(strong('1.0.0.0'),strong('2.0.0.0')),IdentityComparison.NotEquivalent);
  assert.equal(result(strong('1.0.0.0'),strong('2.0.0.0'),{ignoreVersion:true}),IdentityComparison.EquivalentIgnoringVersion);
  assert.deepEqual(compareAssemblyIdentity(strong('1.0.0.0'),strong('2.0.0.0'),{isFrameworkAssembly:()=>true}),{result:IdentityComparison.Equivalent,unificationApplied:true});
  assert.equal(result(weak('1.0.0.0'),weak('2.0.0.0')),IdentityComparison.Equivalent,'weakly named definitions match whatever their version');
  assert.equal(result(strong('1.0.0.0'),new AssemblyIdentity({name:'VersionedLib',version:'1.0.0.0'})),IdentityComparison.NotEquivalent,'a strong reference never binds to a weak definition');
  assert.equal(result(strong('1.0.0.0'),AssemblyIdentity.parse('VersionedLib, Version=1.0.0.0, Culture=neutral, PublicKeyToken=0123456789abcdef')),IdentityComparison.NotEquivalent);
  assert.equal(result(strong('1.0.0.0'),AssemblyIdentity.parse(lib('1.0.0.0').replace('neutral','fr'))),IdentityComparison.NotEquivalent);
  assert.equal(referenceMatchesDefinition('VersionedLib',strong('2.0.0.0')),true,'a partial display name matches on the parts it has');assert.equal(referenceMatchesDefinition('VersionedLib, Version=1.0.0.0',strong('2.0.0.0')),false);assert.equal(referenceMatchesDefinition('Other',strong('2.0.0.0')),false);
});

test('A02-T22 an assembly reference binds to an exact match, else the lowest higher version, else the highest lower version',()=>{
  const id=v=>AssemblyIdentity.parse(lib(v)),resolve=(r,defs)=>resolveAssemblyReference(id(r),defs.map(id));
  assert.deepEqual(resolve('1.0.0.0',['2.0.0.0','1.0.0.0']),{index:1,versionDifference:0});assert.deepEqual(resolve('1.0.0.0',['3.0.0.0','2.0.0.0','0.9.0.0']),{index:1,versionDifference:1});
  assert.deepEqual(resolve('3.0.0.0',['1.0.0.0','2.0.0.0']),{index:1,versionDifference:-1});assert.deepEqual(resolve('1.0.0.0',[]),{index:-1,versionDifference:0});
  assert.deepEqual(resolveAssemblyReference(id('1.0.0.0'),[AssemblyIdentity.parse('Other, Version=1.0.0.0')]),{index:-1,versionDifference:0});
});

test('A02-T22 references bind without diagnostics when every identity matches',()=>{
  const m=bind([Core,V1,'ConsumerOfV1.dll']);assert.ok(m instanceof ReferenceManager);
  assert.deepEqual(m.assemblies.map(a=>a.name),['MiniStandard','VersionedLib','ConsumerOfV1']);assert.deepEqual(m.diagnostics,[]);assert.deepEqual(m.unificationDiagnostics,[]);
  assert.equal(m.corLibrary,m.assemblies[0]);assert.deepEqual(m.assemblies[2].boundReferences,[m.assemblies[0],m.assemblies[1]]);
  const holder=m.getTypeByMetadataName('App.Holder');assert.equal(show(holder.baseType),'Lib.Widget');assert.equal(holder.baseType.containingAssembly,m.assemblies[1]);assert.deepEqual(m.useSiteDiagnostics(holder),[]);
  assert.equal(show(holder.getMembers('Make')[0]),'Lib.Gadget App.Holder.Make(Lib.Widget seed)');
  // the merged global namespace is what name lookup runs over
  const merged=mergeGlobalNamespaces(new NamespaceSymbol(''),m.globalNamespace);assert.equal(merged.lookupType('Lib.Widget'),m.assemblies[1].getTypeByMetadataName('Lib.Widget'));assert.equal(merged.lookupType('System.Int32').specialType,'System_Int32');assert.equal(merged.lookupType('App.Holder'),holder);
  assert.equal(m.findAssembly(lib('1.0.0.0')),m.assemblies[1]);assert.equal(m.findAssembly(lib('2.0.0.0')),null);assert.equal(m.resolveAssembly(AssemblyIdentity.parse(lib('0.5.0.0'))),m.assemblies[1]);
});

test('A02-T22 a reference to an older version unifies with the supplied higher version: CS1701 / CS1702',()=>{
  const m=bind([Core,V2,'ConsumerOfV1.dll']),holder=m.getTypeByMetadataName('App.Holder'),expected={code:'CS1701',args:[lib('1.0.0.0'),'ConsumerOfV1',lib('2.0.0.0'),'VersionedLib']};
  assert.deepEqual(m.diagnostics,[]);assert.deepEqual(m.unificationDiagnostics,[expected]);
  assert.equal(holder.baseType.containingAssembly.identity.versionText,'2.0.0.0','the type binds to the version that was supplied');assert.deepEqual(holder.baseType.getMembers().filter(x=>x.kind===SymbolKind.Field).map(f=>f.name),['Size','Weight']);
  assert.deepEqual(m.useSiteDiagnostics(holder),[expected]);assert.deepEqual(m.useSiteDiagnostics(holder.getMembers('Make')[0]),[expected]);assert.deepEqual(m.useSiteDiagnostics(holder.getMembers('All')[0]),[expected],'through a type argument');
  assert.deepEqual(m.useSiteDiagnostics(m.getTypeByMetadataName('Lib.Widget')),[],'the library itself has no unified reference');
  assert.deepEqual(m.unifications.map(u=>[u.owner.name,u.referenceIdentity.versionText,u.definition.identity.versionText,u.versionDifference]),[['ConsumerOfV1','1.0.0.0','2.0.0.0',1]]);
  assert.equal(defaultSeverity('CS1701'),'warning');assert.equal(diagnosticDescriptor('CS1701').warningLevel,2);
  assert.equal(formatMessage('CS1701',expected.args),`Assuming assembly reference '${lib('1.0.0.0')}' used by 'ConsumerOfV1' matches identity '${lib('2.0.0.0')}' of 'VersionedLib', you may need to supply runtime policy`);
  // Only build/revision differ: CS1702; and of two higher versions the lowest is chosen.
  const close=bind([Core,V2,V105,'ConsumerOfV1.dll']),closeHolder=close.getTypeByMetadataName('App.Holder');
  assert.deepEqual(close.unificationDiagnostics,[{code:'CS1702',args:[lib('1.0.0.0'),'ConsumerOfV1',lib('1.0.0.5'),'VersionedLib']}]);assert.equal(closeHolder.baseType.containingAssembly.identity.versionText,'1.0.0.5');
  assert.equal(diagnosticDescriptor('CS1702').warningLevel,3);assert.deepEqual(close.assemblies.map(a=>a.identity.versionText),['2.1.0.0','2.0.0.0','1.0.0.5','1.0.0.0'],'strongly named versions live side by side');
  // An exact match wins over any unification.
  const exact=bind([Core,V2,V1,V105,'ConsumerOfV1.dll']);assert.deepEqual(exact.unificationDiagnostics,[]);assert.equal(exact.getTypeByMetadataName('App.Holder').baseType.containingAssembly.identity.versionText,'1.0.0.0');
});

test('A02-T22 a reference that needs a higher version than the one supplied is CS1705',()=>{
  const m=bind([Core,V1,'ConsumerOfV2.dll']),holder=m.getTypeByMetadataName('App.Holder'),consumer=m.assemblies[2].identity.getDisplayName();
  const expected={code:'CS1705',args:['ConsumerOfV2',consumer,lib('2.0.0.0'),'VersionedLib',lib('1.0.0.0')]};
  assert.deepEqual(m.unificationDiagnostics,[expected]);assert.deepEqual(m.useSiteDiagnostics(holder),[expected]);assert.equal(m.unifications[0].versionDifference,-1);
  assert.equal(holder.baseType.containingAssembly.identity.versionText,'1.0.0.0','binding continues against the lower version');
  assert.equal(defaultSeverity('CS1705'),'error');
  assert.equal(formatMessage('CS1705',expected.args),`Assembly 'ConsumerOfV2' with identity '${consumer}' uses '${lib('2.0.0.0')}' which has a higher version than referenced assembly 'VersionedLib' with identity '${lib('1.0.0.0')}'`);
  assert.deepEqual(unificationDiagnostic(m.assemblies[2],AssemblyIdentity.parse(lib('2.0.0.0')),m.assemblies[1]),expected);
});

test('A02-T22 a type defined in an assembly that is not referenced is CS0012',()=>{
  const m=bind([Core,'ConsumerOfV1.dll']),holder=m.getTypeByMetadataName('App.Holder'),expected={code:'CS0012',args:['Lib.Widget',lib('1.0.0.0')]};
  assert.deepEqual(m.assemblies[1].boundReferences,[m.assemblies[0],null]);assert.deepEqual(m.diagnostics,[]);
  assert.ok(holder.baseType instanceof ErrorTypeSymbol);assert.deepEqual(holder.baseType.reason,expected);assert.equal(holder.baseType.metadataFullName,'Lib.Widget');
  assert.deepEqual(m.useSiteDiagnostics(holder),[expected]);assert.deepEqual(m.useSiteDiagnostics(holder.getMembers('Make')[0]),[{code:'CS0012',args:['Lib.Gadget',lib('1.0.0.0')]},expected]);
  assert.equal(formatMessage('CS0012',expected.args),`The type 'Lib.Widget' is defined in an assembly that is not referenced. You must add a reference to assembly '${lib('1.0.0.0')}'.`);
  assert.equal(show(holder.getMembers('All')[0].type.originalDefinition),'System.Collections.Generic.List<T>','types from referenced assemblies still resolve');
  assert.equal(m.getTypeByMetadataName('Lib.Widget'),null);
  // A resolver can supply the missing assembly; it joins the compilation as an implicit reference.
  const asked=[],resolved=bind([Core,'ConsumerOfV1.dll'],{resolveMissing:(identity,owner)=>{asked.push([identity.name,owner.name]);return bytes(V1);}});
  assert.deepEqual(asked,[['VersionedLib','ConsumerOfV1']]);assert.deepEqual(resolved.assemblies.map(a=>a.name),['MiniStandard','ConsumerOfV1','VersionedLib']);assert.equal(resolved.references.at(-1).isImplicit,true);
  assert.equal(show(resolved.getTypeByMetadataName('App.Holder').baseType),'Lib.Widget');assert.deepEqual(resolved.useSiteDiagnostics(resolved.getTypeByMetadataName('App.Holder')),[]);
  // Without a core library the predefined types are missing: CS0518.
  const noCore=bind([V1]),size=noCore.getTypeByMetadataName('Lib.Widget').getMembers('Size')[0];assert.equal(noCore.corLibrary,null);assert.deepEqual(size.type.reason,{code:'CS0518',args:['System.Int32']});
  assert.deepEqual(noCore.useSiteDiagnostics(size),[{code:'CS0518',args:['System.Int32']}]);
});

test('A02-T22 duplicate references: identical identities merge, equivalent ones are CS1703, weak same-name ones CS1704',()=>{
  const same=bind([Core,[V1,['A']],[V1,['B']]]);
  assert.deepEqual(same.assemblies.map(a=>a.name),['MiniStandard','VersionedLib']);assert.deepEqual(same.diagnostics,[]);assert.deepEqual(same.aliasesOf(same.assemblies[1]).sort(),['A','B'],'the aliases of the dropped duplicate are kept');
  assert.equal(same.references.filter(r=>r.duplicateOf).length,1);
  // Two versions of a strongly named library are distinct assemblies - unless a framework policy unifies them.
  assert.deepEqual(bind([Core,V1,V2]).diagnostics,[]);assert.equal(bind([Core,V1,V2]).assemblies.length,3);
  const reported=[],unified=bind([Core,V1,V2],{isFrameworkAssembly:id=>id.name==='VersionedLib',report:(node,code,args)=>reported.push({code,args})});
  assert.deepEqual(unified.diagnostics,[{code:'CS1703',args:[V1,V2]}]);assert.deepEqual(reported,unified.diagnostics);assert.deepEqual(unified.assemblies.map(a=>a.identity.versionText),['2.1.0.0','2.0.0.0'],'the later reference is kept');
  assert.equal(formatMessage('CS1703',unified.diagnostics[0].args),`Multiple assemblies with equivalent identity have been imported: '${V1}' and '${V2}'. Remove one of the duplicate references.`);
  const weak=bind([Core,'WeakLib.1.0.0.0.dll','WeakLib.2.0.0.0.dll']);
  assert.deepEqual(weak.diagnostics,[{code:'CS1704',args:['WeakLib','WeakLib.2.0.0.0.dll']}]);assert.deepEqual(weak.assemblies.map(a=>a.identity.getDisplayName()),[weak.corLibrary.identity.getDisplayName(),'WeakLib, Version=2.0.0.0, Culture=neutral, PublicKeyToken=null']);
  assert.equal(formatMessage('CS1704',weak.diagnostics[0].args),"An assembly with the same simple name 'WeakLib' has already been imported. Try removing one of the references (e.g. 'WeakLib.2.0.0.0.dll') or sign them to enable side-by-side.");
  // An already imported assembly symbol can be passed instead of bytes.
  const shared=importAssembly(bytes(Core)),viaSymbol=bindReferences([{assembly:shared},{assembly:shared,aliases:['X']}]);assert.deepEqual(viaSymbol.assemblies,[shared]);assert.deepEqual(viaSymbol.aliasesOf(shared).sort(),['X',GlobalAlias]);
});

test('A02-T22 extern aliases select the references a namespace root can see',()=>{
  const m=bind([Core,[V1,['Old']],[V2,['New',GlobalAlias]]]),[, v1,v2]=m.assemblies;
  assert.deepEqual(m.externAliases.sort(),['New','Old']);assert.deepEqual(m.aliasesOf(m.assemblies[0]),[GlobalAlias]);assert.deepEqual(m.aliasesOf(v1),['Old']);
  // global:: sees the unaliased references and the one that also names `global`
  assert.equal(m.globalNamespace.lookupType('Lib.Widget'),v2.getTypeByMetadataName('Lib.Widget'));assert.equal(m.globalNamespace.getTypeMembers('Widget').length,0);assert.equal(m.globalNamespace.lookupNamespace('Lib').getTypeMembers('Widget').length,1);
  assert.equal(m.getTypeByMetadataName('Lib.Widget'),v2.getTypeByMetadataName('Lib.Widget'));assert.equal(m.getTypeByMetadataName('Lib.Widget','Old'),v1.getTypeByMetadataName('Lib.Widget'));
  const old=m.resolveExternAlias('Old');assert.equal(old.diagnostic,null);assert.equal(old.alias.kind,SymbolKind.Alias);assert.equal(old.alias.isExtern,true);assert.equal(old.alias.name,'Old');
  assert.equal(old.alias.target.lookupType('Lib.Widget'),v1.getTypeByMetadataName('Lib.Widget'));assert.equal(old.alias.target.lookupType('System.Int32'),null,'an alias root sees only its own references');
  assert.equal(m.resolveExternAlias('New').alias.target.lookupType('Lib.Widget'),v2.getTypeByMetadataName('Lib.Widget'));
  assert.deepEqual(m.resolveExternAlias('Missing'),{alias:null,diagnostic:{code:'CS0430',args:['Missing']}});assert.equal(formatMessage('CS0430',['Missing']),"The extern alias 'Missing' was not specified in a /reference option");
  assert.deepEqual(m.resolveExternAlias(GlobalAlias),{alias:null,diagnostic:{code:'CS1681',args:[]}});assert.equal(formatMessage('CS1681',[]),'You cannot redefine the global extern alias');
});

test('A02-T22 type forwarders are followed to the assembly that defines the type',()=>{
  const m=bind([Core,V2,'Facade.dll','FacadeConsumer.dll']),[core,v2,facade,consumer]=m.assemblies,shelf=m.getTypeByMetadataName('Client.Shelf');
  assert.deepEqual(facade.forwardedTypes.map(f=>[f.metadataName,f.assembly.getDisplayName()]),[['Lib.Gadget',lib('2.0.0.0')],['Lib.Widget',lib('2.0.0.0')]]);
  assert.deepEqual(consumer.referencedAssemblyIdentities.map(i=>i.name),['MiniStandard','Facade'],'the consumer only knows the facade');
  assert.equal(facade.getTypeByMetadataName('Lib.Widget'),null,'a forwarder is not a definition');assert.equal(facade.globalNamespace.lookupNamespace('Lib'),null);
  assert.equal(facade.resolveType('Lib.Widget'),v2.getTypeByMetadataName('Lib.Widget'));assert.equal(facade.resolveType('Lib.Nothing'),null);
  assert.equal(shelf.baseType,v2.getTypeByMetadataName('Lib.Widget'));assert.equal(shelf.getMembers('First')[0].type,v2.getTypeByMetadataName('Lib.Gadget'));assert.deepEqual(m.useSiteDiagnostics(shelf),[]);
  assert.equal(m.diagnostics.length+m.unificationDiagnostics.length,0);assert.equal(core.isCorLibrary,true);
  // Lookup by name through a forwarder when only the facade is visible in an alias.
  const aliased=bind([Core,[V2,['Impl']],'Facade.dll']);assert.equal(aliased.globalNamespace.lookupType('Lib.Widget'),null);assert.equal(aliased.getTypeByMetadataName('Lib.Widget'),aliased.assemblies[1].getTypeByMetadataName('Lib.Widget'));
  // The destination assembly is not referenced: CS0012 naming the assembly the forwarder points at.
  const missing=bind([Core,'Facade.dll','FacadeConsumer.dll']),missingShelf=missing.getTypeByMetadataName('Client.Shelf');
  assert.deepEqual(missingShelf.baseType.reason,{code:'CS0012',args:['Lib.Widget',lib('2.0.0.0')]});assert.deepEqual(missing.useSiteDiagnostics(missingShelf),[{code:'CS0012',args:['Lib.Widget',lib('2.0.0.0')]}]);
  assert.deepEqual(missing.getTypeByMetadataName('Lib.Widget').reason,{code:'CS0012',args:['Lib.Widget',lib('2.0.0.0')]});
  // A forwarder satisfied by a different version of the destination: the forwarder's own reference is unified.
  const older=bind([Core,V1,'Facade.dll','FacadeConsumer.dll']);assert.deepEqual(older.unificationDiagnostics.map(d=>[d.code,d.args[0]]),[['CS1705','Facade']]);
  assert.equal(older.getTypeByMetadataName('Client.Shelf').baseType.containingAssembly.identity.versionText,'1.0.0.0');
});

test('A02-T22 a type forwarder cycle is CS0731 and a forwarded type missing from its destination is CS7069',()=>{
  const m=bind([Core,'CycleA.dll','CycleB.dll','CycleConsumer.dll']),walker=m.getTypeByMetadataName('Client.Walker'),start=walker.getMembers('Start')[0],cycleA=m.assemblies[1].identity.getDisplayName();
  assert.deepEqual(m.assemblies[1].forwardedTypes.map(f=>[f.metadataName,f.assembly.name]),[['Loop.Node','CycleB']]);assert.deepEqual(m.assemblies[2].forwardedTypes.map(f=>[f.metadataName,f.assembly.name]),[['Loop.Node','CycleA']]);
  assert.ok(start.type instanceof ErrorTypeSymbol);assert.deepEqual(start.type.reason,{code:'CS0731',args:['Loop.Node',cycleA]});assert.deepEqual(m.useSiteDiagnostics(start),[start.type.reason]);
  assert.equal(formatMessage('CS0731',start.type.reason.args),`The type forwarder for type 'Loop.Node' in assembly '${cycleA}' causes a cycle`);
  // Facade forwards Lib.Widget to its VersionedLib reference. Bound by hand to an assembly that lacks the type, the lookup fails in that assembly.
  const core=importAssembly(bytes(Core)),hollow=importAssembly(bytes('Facade.dll'));hollow.setReferencedAssemblies([core,importAssembly(bytes('CycleConsumer.dll'))]);
  assert.deepEqual(hollow.resolveType('Lib.Widget').reason,{code:'CS7069',args:['Lib.Widget','CycleConsumer']});
  assert.equal(formatMessage('CS7069',['Lib.Widget','CycleConsumer']),"Reference to type 'Lib.Widget' claims it is defined in 'CycleConsumer', but it could not be found");
  // Bound by hand to any assembly that does define the name, the forwarder resolves to that definition.
  const facade=importAssembly(bytes('Facade.dll')).setReferencedAssemblies([core,importAssembly(bytes('WeakLib.1.0.0.0.dll'))]);assert.equal(show(facade.resolveType('Lib.Widget')),'Lib.Widget');assert.equal(facade.resolveType('Lib.Widget').containingAssembly.name,'WeakLib');
});
