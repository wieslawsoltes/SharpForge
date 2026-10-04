import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {encode,decode,validateEnvelope,HandleLeaseTable,AbiError} from '../../../scripts/planning/abi/value-codec.js';
import {createHash} from 'node:crypto';
import {validate} from '../../../scripts/planning/schema/validate.js';
const dir=new URL('../fixtures/value-abi/',import.meta.url),schema=JSON.parse(readFileSync(new URL('../value-abi.schema.json',import.meta.url)));
const envelope=slots=>({abiVersion:1,epoch:1,slots,handles:[]});
for(const name of readdirSync(dir).filter(n=>n.endsWith('.json'))){const fixture=JSON.parse(readFileSync(new URL(name,dir)));test('ABI fixture '+fixture.id,()=>{
 if(fixture.id==='leases'){const table=new HandleLeaseTable(),ref=table.allocate('owned'),strong=table.retain(ref),weak=table.retain(ref,{weak:true});table.collect();assert.equal(table.get(ref),'owned');assert.equal(table.release({id:strong.id,owner:{}}),false);assert(table.release(strong));assert.equal(table.release(strong),false);table.collect();assert.equal(table.dereference(weak),null);assert.throws(()=>table.get(ref),{code:'ABI_STALE_HANDLE'});assert.throws(()=>table.get({...ref,epoch:2}),{code:'ABI_STALE_HANDLE'});table.dispose();assert.throws(()=>table.allocate('late'),{code:'ABI_DISPOSED'});return;}
 if(fixture.mutateFloat32Bits){for(const bits of fixture.mutateFloat32Bits){const buffer=encode(envelope([{kind:'f32',value:'NaN'}]));new DataView(buffer).setBigUint64(32,BigInt(bits)<<8n|9n,true);assert.throws(()=>decode(buffer),{code:fixture.error});}return;}
 const doc=fixture.expand?{...envelope([{kind:'ref',value:{h:1,g:1}}]),handles:[{h:1,g:1,kind:'array',type:'object[]',data:Array(fixture.expand.length).fill(fixture.expand.element)}]}:fixture.document;
 if(fixture.error){assert.throws(()=>encode(doc),{code:fixture.error});return;}validate(schema,doc,{maxNodes:100_000_000});const bytes=encode(doc),roundtrip=decode(bytes);if(fixture.encodedHex)assert.equal(Buffer.from(bytes).toString('hex'),fixture.encodedHex);if(fixture.encodedSha256)assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'),fixture.encodedSha256);assert.deepEqual(roundtrip,doc);assert.deepEqual(new Uint8Array(encode(roundtrip)),new Uint8Array(bytes));
 });}
test('ABI malformed buffers and versions fail with typed diagnostics',()=>{const doc=envelope([{kind:'i32',value:42}]);for(let n=0;n<32;n++)assert.throws(()=>decode(new ArrayBuffer(n)),{code:'ABI_TRUNCATED'});let bytes=encode(doc);assert.throws(()=>decode(bytes.slice(0,-1)),{code:'ABI_TRUNCATED'});for(const [offset,value,code]of [[4,2,'ABI_VERSION'],[6,32,'ABI_HEADER'],[7,1,'ABI_HEADER'],[24,1,'ABI_HEADER'],[32,255,'ABI_TAG']]){bytes=encode(doc);new Uint8Array(bytes)[offset]=value;assert.throws(()=>decode(bytes),{code});}assert.throws(()=>encode({...doc,abiVersion:2}),{code:'ABI_VERSION'});assert.throws(()=>encode(envelope([{kind:'i64',value:9007199254740992}])),{code:'ABI_VALUE'});assert.throws(()=>encode(envelope([{kind:'char',value:65536}])),{code:'ABI_RANGE'});assert.throws(()=>encode(envelope([{kind:'u64',value:'18446744073709551616'}])),{code:'ABI_RANGE'});assert.throws(()=>encode(envelope([{kind:'ref',value:{h:0,g:1}}])),{code:'ABI_HANDLE'});assert.throws(()=>encode({...doc,epoch:0}),{code:'ABI_VALUE'});assert.throws(()=>encode(envelope([{kind:'struct',value:{type:'T:X',fields:[{kind:'mystery'}]}}])),AbiError);});
test('schema scalar negatives agree with codec bounds',()=>{for(const value of [{kind:'bool',value:2},{kind:'char',value:-1},{kind:'i32',value:2147483648},{kind:'f32',value:'nan'}]){assert.throws(()=>validate(schema,envelope([value])),{code:'SCHEMA_INVALID'});assert.throws(()=>validateEnvelope(envelope([value])));}});

test('ABI nested structs fail with typed depth limit',()=>{let value={kind:'null'};for(let i=0;i<66;i++)value={kind:'struct',value:{type:'T:Recursive',fields:[value]}};assert.throws(()=>encode(envelope([value])),{code:'ABI_LIMIT'});});

test('ABI sparse slots and heap data fail before encoding instead of becoming null values',()=>{
  for(const index of [0,1,2]){
    const slots=[{kind:'null'},{kind:'i32',value:42},{kind:'null'}];delete slots[index];
    const documents=[envelope(slots),...['array','object'].map(kind=>({
      ...envelope([{kind:'ref',value:{h:1,g:1}}]),
      handles:[{h:1,g:1,kind,type:kind==='array'?'object[]':'T:Record',data:slots}]
    }))];
    for(const doc of documents)for(const operation of [validateEnvelope,encode]){
      assert.throws(()=>operation(doc),{name:'AbiError',code:'ABI_TAG'});
    }
  }
  const explicitNulls={...envelope([{kind:'null'},{kind:'ref',value:{h:1,g:1}},{kind:'null'}]),
    handles:[{h:1,g:1,kind:'array',type:'object[]',data:[{kind:'null'},{kind:'i32',value:42},{kind:'null'}]}]};
  assert.deepEqual(decode(encode(explicitNulls)),explicitNulls);
});

test('ABI floating width and signed zero apply inside structs and heap arrays',()=>{const doc={...envelope([{kind:'struct',value:{type:'T:Pair',fields:[{kind:'f32',value:1.1},{kind:'f64',value:-0}]}},{kind:'ref',value:{h:1,g:1}}]),handles:[{h:1,g:1,kind:'array',type:'float[]',data:[{kind:'f32',value:1.1}]}]};const decoded=decode(encode(doc));assert.equal(decoded.slots[0].value.fields[0].value,Math.fround(1.1));assert.equal(decoded.slots[0].value.fields[1].value,'-0');assert.equal(decoded.handles[0].data[0].value,Math.fround(1.1));assert.deepEqual(encode(decoded),encode(doc));});

test('ABI strong leases keep the retained identity across caller and roots mutations',()=>{
  const table=new HandleLeaseTable(),original=table.allocate('original'),other=table.allocate('other');
  const borrowed={...original},lease=table.retain(borrowed);
  Object.assign(borrowed,other);
  assert.equal(table.dereference(lease),'original');
  const roots=table.roots();assert.deepEqual(roots,[original]);assert.notEqual(roots[0],borrowed);
  assert.equal(Object.isFrozen(roots[0]),true);
  for(const [key,value] of Object.entries({epoch:original.epoch+1,h:other.h,g:original.g+1})){
    assert.throws(()=>{roots[0][key]=value;},TypeError);
  }
  roots.length=0;table.collect();
  assert.equal(table.get(original),'original');assert.throws(()=>table.get(other),{code:'ABI_STALE_HANDLE'});
  assert.equal(table.release(lease),true);assert.equal(table.release(lease),false);
  table.collect();assert.throws(()=>table.get(original),{code:'ABI_STALE_HANDLE'});assert.equal(table.dereference(lease),null);
});

test('ABI weak leases keep the original identity without rooting a replacement',()=>{
  const table=new HandleLeaseTable(),original=table.allocate('original'),other=table.allocate('other');
  const borrowed={...original},lease=table.retain(borrowed,{weak:true});
  Object.assign(borrowed,other);
  assert.equal(table.dereference(lease),'original');assert.deepEqual(table.roots(),[]);
  table.collect([other]);assert.equal(table.get(other),'other');assert.equal(table.dereference(lease),null);
  assert.throws(()=>table.get(original),{code:'ABI_STALE_HANDLE'});
  assert.equal(table.release(lease),true);assert.equal(table.release(lease),false);
});

test('ABI leases validate the captured tuple and preserve typed stale-handle rejection',()=>{
  const table=new HandleLeaseTable(),original=table.allocate('original'),reads={epoch:0,h:0,g:0};
  const borrowed=Object.defineProperties({},Object.fromEntries(Object.keys(reads).map(key=>[key,{
    get(){return ++reads[key]===1?original[key]:0;}
  }])));
  const lease=table.retain(borrowed);
  assert.deepEqual(reads,{epoch:1,h:1,g:1});assert.equal(table.dereference(lease),'original');
  for(const invalid of [null,{}, {...original,epoch:original.epoch+1},{...original,h:0},{...original,g:original.g+1}]){
    assert.throws(()=>table.retain(invalid),{code:'ABI_STALE_HANDLE'});
  }
  table.collect();assert.equal(table.get(original),'original');
});
