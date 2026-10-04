import test from 'node:test';
import assert from 'node:assert/strict';
import {compile,compileToIL,Compilation,assignable} from '@sharpforge/compiler';
import {compile as compileEntry,compileToIL as compileToILEntry} from '../packages/compiler/src/compile.js';
import {Compilation as CompilationEntry} from '../packages/compiler/src/compilation.js';
import * as conversions from '../packages/compiler/src/conversions.js';
import * as legacyHelpers from '../packages/compiler/src/type-utils.js';

test('A00-T15 conversion seam preserves public entry points and legacy helper identities',()=>{
  assert.equal(compile,compileEntry);
  assert.equal(compileToIL,compileToILEntry);
  assert.equal(Compilation,CompilationEntry);
  assert.equal(assignable,conversions.assignable);
  for(const name of ['supported','aliases','normalize','numeric','isReference','assignable','defaultValue'])
    assert.equal(legacyHelpers[name],conversions[name],name);
});

test('A00-T15 conversion seam retains widening, reference and recovery assignments',()=>{
  for(const [target,from] of [['double','int'],['object','bool'],['string','null'],['Widget','null'],['int[]','null'],['int','error'],['error','bool']])
    assert.equal(assignable(target,from),true,`${from} -> ${target}`);
  for(const [target,from] of [['int','double'],['bool','int'],['int','null'],['void','null'],['object','void']])
    assert.equal(assignable(target,from),false,`${from} -> ${target}`);
});

test('A00-T15 default values retain numeric zero, false and null boundaries',()=>{
  for(const type of ['int','double'])assert.equal(conversions.defaultValue(type),0,type);
  assert.equal(conversions.defaultValue('bool'),false);
  for(const type of ['string','object','Widget','int[]','void','error'])
    assert.equal(conversions.defaultValue(type),null,type);
  assert.equal(conversions.normalize('System.Int32'),'int');
  assert.equal(conversions.normalize('System.String'),'string');
});
