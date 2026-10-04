import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFixture} from '../packages/compiler/test/bound/fixtures.js';

test('core intrinsic property expressions retain their property symbols and separate getter methods', () => {
  const fixture = bindFixture(`using System;
    Exception error = new Exception("message");
    Console.WriteLine(error.Message);
    Console.WriteLine(error.GetType().Name);
    Console.WriteLine(error.GetType().FullName);
    Console.WriteLine(Environment.TickCount);`);
  assert.deepEqual(fixture.diagnostics, []);
  const properties = [];
  const visit = node => {
    if (node.kind === 'PropertyAccess') properties.push(node.property);
    for (const child of node.children) visit(child);
  };
  for (const unit of fixture.compilation.boundPipeline.units) if (unit.kind === 'body' && unit.body) visit(unit.body);
  assert.deepEqual(properties.map(property => property.toDisplayString()), [
    'System.Exception.Message', 'System.Type.Name', 'System.Type.FullName', 'System.Environment.TickCount'
  ]);
  for (const property of properties) {
    assert.equal(property.kind, 'Property');
    assert.equal(property.getMethod.kind, 'Method');
    assert.equal(property.getMethod.associatedSymbol, property);
  }
});
