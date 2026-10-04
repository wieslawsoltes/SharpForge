import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRegistry,contracts,contributionManifest,idReservations} from '@sharpforge/framework';
import {createBuiltinRegistry,Builtins,frameworkBuiltin} from '@sharpforge/bytecode';
import {snapshotContractIds,checkContractIds} from '../scripts/planning/snapshot-contract-ids.js';
import {implementationStatus,checkImplementationRegression,inspectContractImplementations} from '../scripts/planning/check-contract-implementations.js';
const make=()=>createRegistry({reservations:[{name:'one',start:100,size:4},{name:'two',start:200,size:4}]});
const contribution=(name,type)=>({name,register:r=>{r.define(type);r.ctor(type);r.prop(type,'Value','int');}});
test('released framework and bytecode IDs are unchanged',async()=>{const framework=JSON.parse(await readFile(new URL('../planning/contracts/framework-ids.lock.json',import.meta.url))),bytecode=JSON.parse(await readFile(new URL('../planning/contracts/bytecode-ids.lock.json',import.meta.url)));assert(checkContractIds({framework,bytecode},snapshotContractIds()));for(const d of contracts)assert.equal(frameworkBuiltin(d).contract,d);});
test('golden checker reports the first changed id and accepts appends',()=>{const expected=snapshotContractIds(),changed=structuredClone(expected);changed.framework[3].name+='Changed';assert.throws(()=>checkContractIds(expected,changed),/id 3/);const op=structuredClone(expected);op.bytecode.Op.SEQ++;assert.throws(()=>checkContractIds(expected,op),/Op numbering/);const offset=structuredClone(expected);offset.bytecode.contractOffset++;assert.throws(()=>checkContractIds(expected,offset),/offset/);const appended=structuredClone(expected);appended.framework.push({id:99999});appended.bytecode.Op.APPENDED=999;assert(checkContractIds(expected,appended));});
test('reserved contributions have the same IDs in either load order',()=>{const a=make(),b=make();a.registerAll([contribution('one','First'),contribution('two','Second')]);b.registerAll([contribution('two','Second'),contribution('one','First')]);assert.deepEqual(a.contracts,b.contracts);assert.equal(a.contracts[3].id,200);assert.equal(a.types.size,2);});
test('legacy contribution modules validate as a single transaction', () => {
  const registry = createRegistry({reservations: idReservations});
  registry.registerAll(contributionManifest);
  assert.equal(registry.validate(), true);
  const legacy = contracts.filter(contract => contributionManifest.some(range =>
    contract.id >= range.start && contract.id < range.start + range.size));
  assert.equal(registry.contracts.length, legacy.length);
  for (const [index, contract] of legacy.entries()) assert.deepEqual(registry.contracts[index], contract);
});
for(const [name,register,pattern]of [
 ['duplicate type',r=>{r.define('A');r.define('A');},/Duplicate type/],
 ['duplicate member',r=>{r.define('A');r.member('A','M',[],'void');r.member('A','M',[],'void');},/Duplicate member/],
 ['unknown owner',r=>r.prop('Absent','Value','int'),/undefined type/],
 ['unknown parameter',r=>{r.define('A');r.member('A','M',['Unknown'],'void');},/Unknown type/],
 ['block overflow',r=>{r.define('A');for(let i=0;i<5;i++)r.member('A','M'+i,[],'void');},/overflow/],
 ['malformed member',r=>{r.define('A');r.member('A','M',null,'void');},/Malformed/]
])test(name+' rolls back the entire contribution',()=>{const r=make();assert.throws(()=>r.register({name:'one',register}),e=>e.message.includes('[one]')&&pattern.test(e.message));assert.equal(r.types.size,0);assert.equal(r.contracts.length,0);r.register(contribution('one','Valid'));});
test('cancellation rolls back and separate registries do not leak state',()=>{const r=make(),abort=new AbortController();assert.throws(()=>r.registerAll([{name:'one',register:r=>{r.define('A');abort.abort();}}],{signal:abort.signal}),{name:'AbortError'});assert.equal(r.types.size,0);assert.equal(make().types.size,0);});
test('overlapping, negative, duplicate and exhausted reservations reject',()=>{for(const reservations of [[{name:'one',start:-1,size:1}],[{name:'one',start:0,size:0}],[{name:'one',start:0,size:2},{name:'two',start:1,size:2}]])assert.throws(()=>createRegistry({reservations}));const r=make();r.register(contribution('one','A'));assert.throws(()=>r.register(contribution('one','B')),/Duplicate contribution/);});
test('builtin contributions append atomically and never shift framework offsets', () => {
  const registry = createBuiltinRegistry();
  const added = registry.register({name: 'example', definitions: [['Example', 0, 0, 'void', []]]});
  assert.equal(added[0].id, Builtins.length);
  const entries = registry.entries;
  const keys = Object.keys(Builtins);
  assert.equal(entries.length, Builtins.length + 1);
  assert.equal(Object.keys(entries).length, keys.length + 1);
  for (const key of keys) assert.strictEqual(entries[key], Builtins[key], `Builtin ID ${key}`);
  assert.throws(() => registry.register({
    name: 'bad', definitions: [['Fresh', 0, 0, 'void', []], ['Example', 0, 0, 'void', []]]
  }), /Duplicate/);
  assert.equal(registry.get('Fresh'), null);
  assert.throws(() => registry.register({name: 'bad', definitions: [['Invalid', -1, 0, 'void', []]]}), /Invalid/);
});
test('implementation regression gate detects either engine losing a handler',()=>{assert.deepEqual([[true,true],[true,false],[false,true],[false,false]].map(([s,c])=>implementationStatus(s,c)),['implemented','source-only','cil-only','missing']);const previous={contracts:[{id:5,source:{handled:true},cil:{handled:true}}]};assert.throws(()=>checkImplementationRegression(previous,{contracts:[{id:5,source:{handled:true},cil:{handled:false}}]}),/id 5/);assert(checkImplementationRegression(previous,previous));});

test('every real source/CIL dispatch result meets the committed reachability baseline',async()=>{const previous=JSON.parse(await readFile(new URL('../planning/contracts/contract-implementations.json',import.meta.url)));assert(checkImplementationRegression(previous,inspectContractImplementations()));});

test('released contribution order is pinned while new area order remains independent',()=>{const r=createRegistry({reservations:idReservations}),reordered=[...contributionManifest];[reordered[4],reordered[5]]=[reordered[5],reordered[4]];assert.throws(()=>r.registerAll(reordered),/Released contribution order changed at id 795/);assert.equal(r.contracts.length,0);});
