import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {CastCache,castReference,checkArrayStore} from '../packages/runtime/src/execution/casting.js';
import {castingRegistry,typePairs} from './a05-type-fixtures.js';

for(const [source,target,expected] of typePairs)test(`A05 assignability: ${source} -> ${target}`,()=>{
  const registry=castingRegistry(),cache=new CastCache(registry);
  assert.equal(cache.isAssignableFrom(target,source),expected);
  assert.equal(cache.isAssignableFrom(registry.get(target),registry.get(source)),expected);
  assert.equal(cache.hits,1);
});

test('A05 cast cache has at least 60 independent .NET reference pairs',()=>assert(typePairs.length>=60));
test('A05 casts use object headers and preserve null, failure and boxed enum distinctions',()=>{
  const heap=new ManagedHeap({methodTables:castingRegistry()}),registry=heap.methodTables;
  const derived=heap.object(registry.get('CastFixtures.Derived'),[]);
  heap.get(derived).type='CastFixtures.Other'; // Compatibility display labels are not identity.
  assert.equal(castReference(heap,derived,'CastFixtures.IRoot'),derived);
  assert.equal(castReference(heap,derived,'CastFixtures.Other',false),null);
  assert.throws(()=>castReference(heap,derived,'CastFixtures.Other'),{name:'InvalidCastException'});
  assert.equal(castReference(heap,null,'CastFixtures.Derived'),null);
  const boxed=heap.allocate('box',registry.get('CastFixtures.Color'),[0]);
  assert.equal(castReference(heap,boxed,'System.Enum'),boxed);
  assert.equal(castReference(heap,boxed,'CastFixtures.Color'),boxed);
  assert.equal(castReference(heap,boxed,'System.Nullable`1<CastFixtures.Color>'),boxed);
  assert.equal(castReference(heap,boxed,'int',false),null);
  assert.throws(()=>castReference(heap,boxed,'int'),{name:'InvalidCastException'});
  const integer=heap.allocate('box','int',[42]);
  assert.equal(castReference(heap,integer,'System.Nullable`1<int>'),integer);
  assert.equal(castReference(heap,integer,'System.Nullable`1<long>',false),null);
});
test('A05 covariant array stores retain the actual element constraint',()=>{
  const heap=new ManagedHeap(),array=heap.array('string',1),text=heap.string('ok'),other=heap.object('object',[]),record=heap.get(array);
  assert.equal(castReference(heap,array,'object[]'),array);
  assert.equal(checkArrayStore(heap,record,text),text);
  assert.equal(checkArrayStore(heap,record,null),null);
  assert.throws(()=>checkArrayStore(heap,record,other),{name:'ArrayTypeMismatchException'});
  assert.throws(()=>checkArrayStore(heap,record,42),{name:'ArrayTypeMismatchException'});
  assert.deepEqual(record.data,[null]);
});
test('A05 cast boundary inputs and cache clearing stay explicit',()=>{
  const registry=castingRegistry(),cache=new CastCache(registry);
  assert.equal(cache.isAssignableFrom('object',null),false);
  assert.equal(cache.isAssignableFrom('object','int*'),false);
  assert.equal(cache.isAssignableFrom('object','int&'),false);
  assert.equal(cache.isAssignableFrom('int&','int&'),true);
  assert.equal(cache.isAssignableFrom('object','First.Widget'),true);
  cache.clear();assert.equal(cache.hits,0);assert.equal(cache.misses,0);
  assert.throws(()=>cache.isAssignableFrom('object',castingRegistry().get('First.Widget')),/another runtime/);
});
